import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "node:crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

// Configuración que viene de Terraform
const ENABLED = process.env.COMMENTS_ENABLED === "true"; // interruptor de emergencia
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 50); // comentarios al día en total
const IP_CAP = Number(process.env.IP_CAP ?? 3); // comentarios al día por IP
const TURNSTILE_PARAM = process.env.TURNSTILE_SECRET_PARAM ?? ""; // nombre del parámetro en SSM

// La clave secreta de Turnstile vive en SSM Parameter Store (SecureString).
// Se lee la primera vez que hace falta y se guarda en memoria mientras la
// Lambda siga caliente. Si la lectura falla no se cachea nada y se reintenta.
const ssm = new SSMClient({});
let turnstileSecret = null;
async function getTurnstileSecret() {
  if (turnstileSecret === null) {
    const out = await ssm.send(
      new GetParameterCommand({ Name: TURNSTILE_PARAM, WithDecryption: true })
    );
    turnstileSecret = out.Parameter?.Value ?? "";
  }
  return turnstileSecret;
}

const NICK_RE = /^[\p{L}\p{N} _-]{2,20}$/u;
const TITLE_RE = /^\d{1,10}$/;
const URL_RE = /(https?:\/\/|www\.)/i;
const MAX_BODY = 2000;
const MAX_TEXT = 500;

// Claves especiales de la tabla (la consulta pública solo acepta ids numéricos,
// así que nunca puede leerlas):
//   "#limits"  contadores diarios
//   "#ratings" una fila por película con { sum, count } de notas aprobadas
//              (la actualiza el script de moderación al aprobar)
//   "#bans"    una fila por IP baneada (la gestiona el script de moderación)

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

// De { sum, count } a { count, average } (average es null si no hay notas)
const stats = (item) =>
  item && item.count > 0
    ? { count: item.count, average: Math.round((item.sum / item.count) * 10) / 10 }
    : { count: 0, average: null };

// Suma 1 a un contador diario, pero solo si no ha llegado al tope.
// La condición se evalúa dentro de DynamoDB de forma atómica, así que
// dos peticiones simultáneas no pueden colarse por encima del límite.
// Los contadores caducan solos por TTL.
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

// Verifica el token del CAPTCHA con Cloudflare. Devuelve "ok", "invalid"
// o "unavailable" (si Cloudflare no responde: se cierra por seguridad).
async function verifyTurnstile(token, ip) {
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) {
    return "invalid";
  }
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: await getTurnstileSecret(),
          response: token,
          remoteip: ip,
        }),
        signal: AbortSignal.timeout(2500),
      }
    );
    const out = await res.json();
    return out.success === true ? "ok" : "invalid";
  } catch {
    return "unavailable";
  }
}

// GET /comments?titleId=1398 -> comentarios aprobados + media de notas
async function listComments(event) {
  const titleId = event.queryStringParameters?.titleId ?? "";
  if (!TITLE_RE.test(titleId)) return json(400, { error: "invalid_title" });

  const [out, st] = await Promise.all([
    db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "titleId = :t",
        FilterExpression: "#s = :a",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":t": titleId, ":a": "approved" },
        ScanIndexForward: false, // los más recientes primero
      })
    ),
    db.send(
      new GetCommand({
        TableName: TABLE,
        Key: { titleId: "#ratings", sk: titleId },
      })
    ),
  ]);

  // Solo se exponen estos campos: nunca el hash de la IP ni el estado
  const comments = (out.Items ?? []).map(
    ({ nickname, text, rating, createdAt }) => ({
      nickname,
      text,
      rating,
      createdAt,
    })
  );
  return json(200, { comments, stats: stats(st.Item) });
}

// GET /ratings -> media y número de notas de todas las películas valoradas
async function listRatings() {
  const out = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "titleId = :t",
      ExpressionAttributeValues: { ":t": "#ratings" },
    })
  );
  const ratings = (out.Items ?? [])
    .filter((i) => i.count > 0)
    .map((i) => ({ titleId: i.sk, ...stats(i) }));
  return json(200, { ratings }, { "cache-control": "public, max-age=60" });
}

// POST /comments {titleId, nickname, text, rating, turnstileToken} -> "pending"
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
  const rating = Number(data.rating);

  if (!TITLE_RE.test(titleId)) return json(400, { error: "invalid_title" });
  if (!NICK_RE.test(nickname)) return json(400, { error: "invalid_nickname" });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json(400, { error: "invalid_rating" });
  }
  if (
    text.length < 1 ||
    text.length > MAX_TEXT ||
    /[<>]/.test(text) ||
    URL_RE.test(text)
  ) {
    return json(400, { error: "invalid_text" });
  }

  const ip = event.requestContext.http.sourceIp ?? "unknown";

  // Identificador estable de la IP, solo para poder banearla. Se guarda con
  // el comentario (nunca se expone) y permite al script de moderación
  // banear a quien lo escribió sin conocer su IP en claro.
  const ipId = createHash("sha256").update(`ban|${ip}`).digest("hex").slice(0, 32);
  const banned = await db.send(
    new GetCommand({ TableName: TABLE, Key: { titleId: "#bans", sk: ipId } })
  );
  if (banned.Item) return json(403, { error: "forbidden" });

  // CAPTCHA (Cloudflare Turnstile), verificado en el servidor. Va después
  // de la validación barata y antes de los contadores: un token falso no
  // gasta cupo.
  const captcha = await verifyTurnstile(data.turnstileToken, ip);
  if (captcha === "unavailable") {
    return json(503, { error: "captcha_unavailable" });
  }
  if (captcha !== "ok") return json(403, { error: "captcha_failed" });

  // Topes diarios (día en UTC). Solo cuentan los comentarios válidos.
  // Primero el de la IP: así una sola IP nunca puede gastar más de IP_CAP
  // del tope global.
  const day = new Date().toISOString().slice(0, 10);
  // La IP de los contadores no se guarda en claro, solo un hash que caduca
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
        rating,
        ipId,
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
    if (method === "GET") {
      return event.rawPath === "/ratings"
        ? await listRatings()
        : await listComments(event);
    }
    if (method === "POST") return await createComment(event);
    return json(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("comments error", err.name);
    return json(500, { error: "internal" });
  }
};
