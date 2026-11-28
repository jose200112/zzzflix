// Piezas comunes de las Lambdas de zzzflix (comentarios y reportes).
//
// Viven en un solo archivo para que las dos Lambdas hagan EXACTAMENTE lo mismo
// en lo que importa de verdad: el hash de la IP (si difiriera, un baneo hecho
// desde una Lambda no valdría en la otra), el CAPTCHA, los contadores y los
// interruptores de cierre. Terraform copia este archivo dentro del zip de cada
// Lambda (carpeta "shared/").
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHmac } from "node:crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const TABLE = process.env.TABLE_NAME;

// Configuración que viene de Terraform
const ENABLED = process.env.COMMENTS_ENABLED === "true"; // interruptor de emergencia
const TURNSTILE_PARAM = process.env.TURNSTILE_SECRET_PARAM ?? ""; // nombre del parámetro en SSM
const IP_SALT_PARAM = process.env.IP_SALT_PARAM;

export const TITLE_RE = /^\d{1,10}$/;
const MAX_BODY = 2000;

// Claves especiales de la tabla (la consulta pública solo acepta ids numéricos,
// así que nunca puede leerlas):
//   "#limits"  contadores diarios (comentarios, IA y reportes)
//   "#ratings" una fila por película con { sum, count } de notas aprobadas
//              (la actualiza el script de moderación al aprobar)
//   "#bans"    una fila por IP baneada (la gestiona el script de moderación)
//   "#flags"   interruptor de emergencia: la Lambda "killswitch" cierra los
//              comentarios cuando salta una alarma y moderate.py los reabre
//   "#reports" una fila por cada persona que reporta un comentario. Nunca se
//              borra sola ni oculta el comentario: la lee moderate.py (rep)

export const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

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

// Sal de los hashes de IP. Vive en SSM (se crea a mano con la CLI) y se cachea
// en memoria. Si falta, la función falla: nunca se cae a un hash sin sal.
let ipSalt = null;
async function getIpSalt() {
  if (ipSalt === null) {
    const out = await ssm.send(
      new GetParameterCommand({ Name: IP_SALT_PARAM, WithDecryption: true })
    );
    const value = out.Parameter?.Value ?? "";
    if (!value) throw new Error("ip salt missing");
    ipSalt = value;
  }
  return ipSalt;
}

// HMAC-SHA256 con la sal, recortado a 32 hex. Sin la sal no se puede recuperar
// la IP probando las ~4.300 millones de direcciones IPv4.
export async function ipDigest(message) {
  return createHmac("sha256", await getIpSalt())
    .update(message)
    .digest("hex")
    .slice(0, 32);
}

// Suma 1 a un contador diario, pero solo si no ha llegado al tope.
// La condición se evalúa dentro de DynamoDB de forma atómica, así que
// dos peticiones simultáneas no pueden colarse por encima del límite.
// Los contadores caducan solos por TTL.
export async function bump(sk, cap) {
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

// ¿Está cerrada la escritura? Hay dos interruptores: la variable de Terraform
// (COMMENTS_ENABLED) y la fila "#flags" que enciende la alarma de picos y que
// apaga o reabre moderate.py. Comentar y reportar comparten los dos.
export async function isClosed() {
  if (!ENABLED) return true;
  const flag = await db.send(
    new GetCommand({ TableName: TABLE, Key: { titleId: "#flags", sk: "comments" } })
  );
  return flag.Item?.disabled === true;
}

// Lee el cuerpo JSON de un POST. Devuelve { data } o { response } con el error.
export function parseBody(event) {
  if ((event.body ?? "").length > MAX_BODY) {
    return { response: json(413, { error: "too_large" }) };
  }
  try {
    const data = JSON.parse(event.body ?? "{}");
    if (data === null || typeof data !== "object") throw new Error("not an object");
    return { data };
  } catch {
    return { response: json(400, { error: "invalid_json" }) };
  }
}

// Comprobaciones comunes a comentar y reportar: baneo y CAPTCHA. Van después de
// validar los datos (barato) y antes de los contadores: una IP baneada o un
// token falso no gastan cupo. Devuelve { ip, ipId } o { response } con el error.
export async function screenClient(event, turnstileToken) {
  const ip = event.requestContext.http.sourceIp ?? "unknown";

  // Identificador estable de la IP, solo para poder banearla. Se guarda con
  // el comentario (nunca se expone) y permite al script de moderación
  // banear a quien lo escribió sin conocer su IP en claro.
  const ipId = await ipDigest(`ban|${ip}`);
  const banned = await db.send(
    new GetCommand({ TableName: TABLE, Key: { titleId: "#bans", sk: ipId } })
  );
  if (banned.Item) return { response: json(403, { error: "forbidden" }) };

  // CAPTCHA (Cloudflare Turnstile), verificado en el servidor
  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (captcha === "unavailable") {
    return { response: json(503, { error: "captcha_unavailable" }) };
  }
  if (captcha !== "ok") {
    return { response: json(403, { error: "captcha_failed" }) };
  }

  return { ip, ipId };
}
