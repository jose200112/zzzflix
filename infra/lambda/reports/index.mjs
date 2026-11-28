import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
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

// Lambda del botón de reportar (POST /reports). Es una función aparte de la de
// comentarios para que su rol de IAM sea mínimo: no puede llamar a Bedrock, no
// puede publicar comentarios ni tocar las notas ni los baneos.

// Configuración que viene de Terraform
const REPORT_IP_CAP = Number(process.env.REPORT_IP_CAP ?? 5); // reportes al día por IP
const REPORT_DAILY_CAP = Number(process.env.REPORT_DAILY_CAP ?? 30); // reportes al día en total

// Id público de un comentario (su clave de orden): fecha ISO + "#" + UUID
const COMMENT_ID_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// POST /reports {titleId, commentId, turnstileToken}
//   -> 200 "reported" | 404 "not_found" | 429 "report_limit"
// Un reporte NUNCA oculta ni borra el comentario: solo deja una fila en la cola
// de revisión que lee moderate.py (comando "rep"). Así nadie puede censurar a
// otra persona a base de reportes: decide siempre un humano.
async function createReport(event) {
  if (await isClosed()) return json(503, { error: "comments_disabled" });

  const body = parseBody(event);
  if (body.response) return body.response;
  const data = body.data;

  const titleId = String(data.titleId ?? "");
  const commentId = String(data.commentId ?? "");
  if (!TITLE_RE.test(titleId)) return json(400, { error: "invalid_title" });
  if (!COMMENT_ID_RE.test(commentId)) {
    return json(400, { error: "invalid_comment" });
  }

  const client = await screenClient(event, data.turnstileToken);
  if (client.response) return client.response;
  const { ip } = client;

  // Topes diarios propios (no gastan el cupo de los comentarios): uno por IP y
  // otro global, con las claves "rip#" y "rglobal#" de la partición #limits.
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = await ipDigest(`${day}|${TABLE}|${ip}`);
  if (!(await bump(`rip#${day}#${ipHash}`, REPORT_IP_CAP))) {
    return json(429, { error: "report_limit" });
  }
  if (!(await bump(`rglobal#${day}`, REPORT_DAILY_CAP))) {
    return json(429, { error: "report_limit" });
  }

  // Solo se pueden reportar comentarios publicados
  const target = await db.send(
    new GetCommand({ TableName: TABLE, Key: { titleId, sk: commentId } })
  );
  if (target.Item?.status !== "approved") {
    return json(404, { error: "not_found" });
  }

  // Una fila por (comentario, persona). La condición impide que la misma
  // persona cuente dos veces el mismo comentario.
  const reporter = await ipDigest(`report|${ip}`);
  try {
    await db.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          titleId: "#reports",
          sk: `${titleId}|${commentId}|${reporter}`,
          commentTitle: titleId,
          commentSk: commentId,
          reportedAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(sk)",
      })
    );
  } catch (err) {
    // Ya lo había reportado: se responde igual para no revelar nada
    if (err.name !== "ConditionalCheckFailedException") throw err;
  }
  return json(200, { status: "reported" });
}

export const handler = async (event) => {
  try {
    if (event.requestContext.http.method !== "POST") {
      return json(405, { error: "method_not_allowed" });
    }
    return await createReport(event);
  } catch (err) {
    console.error("reports error", err.name);
    return json(500, { error: "internal" });
  }
};
