import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

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
