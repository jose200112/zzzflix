import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { BedrockRuntimeClient, ApplyGuardrailCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  TABLE,
  TITLE_RE,
  bump,
  db,
  ipDigest,
  isClosed,
  json,
  parseBody,
  screenClient,
} from "../shared/common.mjs";

// Configuración que viene de Terraform
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 50); // comentarios al día en total
const IP_CAP = Number(process.env.IP_CAP ?? 3); // comentarios al día por IP

// Filtro automático (Amazon Bedrock Guardrails)
const GUARDRAIL_ID = process.env.GUARDRAIL_ID ?? "";
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION ?? "DRAFT";
// Tope propio de ejecuciones de Guardrails al día. Es independiente de DAILY_CAP:
// aunque falle otra capa, la IA nunca se ejecuta más veces que esto. Con 0 el
// filtro queda apagado y todos los comentarios van a revisión manual.
const GUARDRAIL_CAP = Number(process.env.GUARDRAIL_CAP ?? 50);

const NICK_RE = /^[\p{L}\p{N} _-]{2,20}$/u;
// Enlaces: con esquema (http://), con www. o direcciones tipo ejemplo.com
const URL_RE =
  /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|io|xyz|info|biz|ru|cn|tk|ly|app|dev|link|site|online|shop|top|club|store)\b/i;
const MAX_TEXT = 500;

// De { sum, count } a { count, average } (average es null si no hay notas)
const stats = (item) =>
  item && item.count > 0
    ? { count: item.count, average: Math.round((item.sum / item.count) * 10) / 10 }
    : { count: 0, average: null };

// Resumen de por qué Guardrails bloqueó (solo tipos, nunca el texto), para
// poder ajustar los filtros mirando los registros.
function describeIntervention(out) {
  try {
    const found = new Set();
    for (const a of out.assessments ?? []) {
      for (const f of a.contentPolicy?.filters ?? []) found.add(f.type);
      if (a.wordPolicy?.customWords?.length || a.wordPolicy?.managedWordLists?.length) {
        found.add("WORD");
      }
      for (const e of a.sensitiveInformationPolicy?.piiEntities ?? []) found.add(e.type);
      if (a.sensitiveInformationPolicy?.regexes?.length) found.add("REGEX");
    }
    return [...found].join(",");
  } catch {
    return "";
  }
}

// Sin reintentos: cada llamada cuenta una ejecución y el tope cuenta intentos.
const bedrock = new BedrockRuntimeClient({ maxAttempts: 1 });

// Pasa el comentario por Guardrails. Devuelve "ok", "blocked" o "error".
// Apodo y texto van en un solo bloque (hasta 1000 caracteres = una unidad de
// texto = una ejecución facturable). La línea "guardrail_call" alimenta la
// métrica y la alarma de uso; nunca se registra el texto del comentario.
async function checkWithGuardrail(nickname, text) {
  try {
    const out = await bedrock.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier: GUARDRAIL_ID,
        guardrailVersion: GUARDRAIL_VERSION,
        source: "INPUT",
        content: [{ text: { text: `${nickname}\n${text}` } }],
      }),
      { abortSignal: AbortSignal.timeout(4000) }
    );
    const verdict = out.action === "GUARDRAIL_INTERVENED" ? "blocked" : "ok";
    console.log("guardrail_call", verdict, describeIntervention(out));
    return verdict;
  } catch (err) {
    console.log("guardrail_call", "error", err.name);
    return "error";
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

  // Solo se exponen estos campos: nunca el hash de la IP ni el estado.
  // "id" es la clave de orden del comentario: el botón de reportar la devuelve.
  const comments = (out.Items ?? []).map(
    ({ sk, nickname, text, rating, createdAt }) => ({
      id: sk,
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

// POST /comments {titleId, nickname, text, rating, turnstileToken}
//   -> 201 "published" (Guardrails OK) | 202 "pending" (Guardrails no disponible)
//   -> 400 "content_blocked" (Guardrails bloquea) | 429 (topes diarios)
async function createComment(event) {
  // Va el primero: con los comentarios cerrados no se gasta ni Turnstile ni cupo
  if (await isClosed()) return json(503, { error: "comments_disabled" });

  const body = parseBody(event);
  if (body.response) return body.response;
  const data = body.data;

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

  // Baneo y CAPTCHA (ver screenClient en shared/common.mjs)
  const client = await screenClient(event, data.turnstileToken);
  if (client.response) return client.response;
  const { ip, ipId } = client;

  // Topes diarios (día en UTC). Cuentan todos los intentos que llegan hasta
  // aquí, también los que luego bloquea el filtro; los que no pasan la
  // validación, el baneo o el CAPTCHA no gastan cupo.
  // Primero el de la IP: así una sola IP nunca puede gastar más de IP_CAP
  // del tope global.
  const day = new Date().toISOString().slice(0, 10);
  // La IP de los contadores no se guarda en claro, solo un hash que caduca
  const ipHash = await ipDigest(`${day}|${TABLE}|${ip}`);

  if (!(await bump(`ip#${day}#${ipHash}`, IP_CAP))) {
    return json(429, { error: "ip_limit" });
  }
  if (!(await bump(`global#${day}`, DAILY_CAP))) {
    return json(429, { error: "daily_limit" });
  }

  // Filtro automático. Es lo último antes de guardar. Su contador sube ANTES
  // de llamar y cuenta toda ejecución (ok, bloqueo o error). Al llegar al tope
  // se rechaza sin llamar a la IA. Si el filtro está apagado (tope 0) o falla,
  // el comentario queda pendiente para revisión manual.
  let verdict = "unchecked";
  if (GUARDRAIL_CAP > 0 && GUARDRAIL_ID) {
    if (!(await bump(`guardrail#${day}`, GUARDRAIL_CAP))) {
      console.warn("guardrail cap reached");
      return json(429, { error: "daily_limit" });
    }
    verdict = await checkWithGuardrail(nickname, text);
    if (verdict === "blocked") return json(400, { error: "content_blocked" });
  }

  const createdAt = new Date().toISOString();
  const item = {
    titleId,
    sk: `${createdAt}#${randomUUID()}`,
    nickname,
    text,
    rating,
    ipId,
    createdAt,
  };

  if (verdict === "ok") {
    // Se publica y su nota entra en la media en una sola transacción
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { ...item, status: "approved", moderation: "guardrails" },
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { titleId: "#ratings", sk: titleId },
              UpdateExpression: "ADD #sum :r, #count :one",
              ExpressionAttributeNames: { "#sum": "sum", "#count": "count" },
              ExpressionAttributeValues: { ":r": rating, ":one": 1 },
            },
          },
        ],
      })
    );
    return json(201, { status: "published" });
  }

  await db.send(
    new PutCommand({ TableName: TABLE, Item: { ...item, status: "pending" } })
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
