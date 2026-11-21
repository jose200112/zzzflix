import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "node:crypto";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

// Configuración que viene de Terraform
const ENABLED = process.env.COMMENTS_ENABLED === "true"; // interruptor de emergencia
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 50); // comentarios al día en total
const IP_CAP = Number(process.env.IP_CAP ?? 3); // comentarios al día por IP

const NICK_RE = /^[\p{L}\p{N} _-]{2,20}$/u;
const TITLE_RE = /^\d{1,10}$/;
const URL_RE = /(https?:\/\/|www\.)/i;
const MAX_BODY = 2000;
const MAX_TEXT = 500;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Suma 1 a un contador diario, pero solo si no ha llegado al tope.
// La condición se evalúa dentro de DynamoDB de forma atómica, así que
// dos peticiones simultáneas no pueden colarse por encima del límite.
// Los contadores viven bajo titleId "#limits", que la consulta pública
// nunca puede pedir (solo acepta números), y caducan solos por TTL.
async function bump(sk, cap) {
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 86400;
  try {
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { titleId: "#limits", sk },
        UpdateExpression: "SET expiresAt = :exp ADD hits :one",
        ConditionExpression: "attribute_not_exists(hits) OR hits < :cap",
        ExpressionAttributeValues: { ":one": 1, ":cap": cap, ":exp": expiresAt },
      })
    );
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

// GET /comments?titleId=1398 -> solo comentarios aprobados
async function listComments(event) {
  const titleId = event.queryStringParameters?.titleId ?? "";
  if (!TITLE_RE.test(titleId)) return json(400, { error: "invalid_title" });

  const out = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "titleId = :t",
      FilterExpression: "#s = :a",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":t": titleId, ":a": "approved" },
      ScanIndexForward: false, // los más recientes primero
    })
  );

  const comments = (out.Items ?? []).map(({ nickname, text, createdAt }) => ({
    nickname,
    text,
    createdAt,
  }));
  return json(200, { comments });
}

// POST /comments {titleId, nickname, text} -> se guarda como "pending"
async function createComment(event) {
  if (!ENABLED) return json(503, { error: "comments_disabled" });

  if ((event.body ?? "").length > MAX_BODY) {
    return json(413, { error: "too_large" });
  }

  let data;
  try {
    data = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const titleId = String(data.titleId ?? "");
  const nickname = String(data.nickname ?? "").trim();
  const text = String(data.text ?? "").trim();

  if (!TITLE_RE.test(titleId)) return json(400, { error: "invalid_title" });
  if (!NICK_RE.test(nickname)) return json(400, { error: "invalid_nickname" });
  if (
    text.length < 1 ||
    text.length > MAX_TEXT ||
    /[<>]/.test(text) ||
    URL_RE.test(text)
  ) {
    return json(400, { error: "invalid_text" });
  }

  // Topes diarios (día en UTC). Solo cuentan los comentarios válidos.
  // Primero el de la IP: así una sola IP nunca puede gastar más de IP_CAP
  // del tope global.
  const day = new Date().toISOString().slice(0, 10);
  const ip = event.requestContext.http.sourceIp ?? "unknown";
  // La IP no se guarda en claro, solo un hash que caduca a los 2 días
  const ipHash = createHash("sha256")
    .update(`${day}|${TABLE}|${ip}`)
    .digest("hex")
    .slice(0, 32);

  if (!(await bump(`ip#${day}#${ipHash}`, IP_CAP))) {
    return json(429, { error: "ip_limit" });
  }
  if (!(await bump(`global#${day}`, DAILY_CAP))) {
    return json(429, { error: "daily_limit" });
  }

  const createdAt = new Date().toISOString();
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        titleId,
        sk: `${createdAt}#${randomUUID()}`,
        nickname,
        text,
        status: "pending",
        createdAt,
      },
    })
  );

  return json(202, { status: "pending" });
}

export const handler = async (event) => {
  try {
    const method = event.requestContext.http.method;
    if (method === "GET") return await listComments(event);
    if (method === "POST") return await createComment(event);
    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("comments error", err.name);
    return json(500, { error: "internal" });
  }
};
