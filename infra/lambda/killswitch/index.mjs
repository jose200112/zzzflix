// Kill switch automático. Lo invoca SNS cuando salta una alarma grave (picos
// de intentos de POST). Solo enciende el interruptor en DynamoDB: la Lambda de
// comentarios lo consulta y deja de aceptar comentarios nuevos. Leer comentarios
// sigue funcionando. Se reabre a mano con moderate.py ("abrir").
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  let reason = "alarma";
  try {
    const msg = JSON.parse(event.Records?.[0]?.Sns?.Message ?? "{}");
    if (typeof msg.AlarmName === "string") reason = msg.AlarmName.slice(0, 100);
  } catch {
    // El mensaje no es JSON de CloudWatch: se usa el motivo genérico
  }

  await db.send(
    new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        titleId: "#flags",
        sk: "comments",
        disabled: true,
        reason,
        at: new Date().toISOString(),
      },
    })
  );
  console.log("kill switch encendido por", reason);
};
