# observability v2: reutiliza lo que ya existe en alarms.tf (tema SNS "alerts",
# alarmas de errores, concurrencia y tráfico), security.tf (presupuesto) y
# variables.tf (alert_email, monthly_budget_usd).
# ---------------------------------------------------------------
# Observabilidad y protección automática de los comentarios
#   - Dashboard de CloudWatch
#   - Alarma de errores 5xx de la API
#   - Kill switch automático: si salta la alarma de picos de POST, una Lambda
#     enciende un interruptor en DynamoDB ("#flags") y la Lambda de comentarios
#     deja de aceptar comentarios nuevos. Leer sigue funcionando. Se reabre a
#     mano con moderate.py ("abrir").
# ---------------------------------------------------------------

variable "post_spike_threshold" {
  description = "Intentos de POST en 5 minutos que disparan el kill switch automático"
  type        = number
  default     = 30
}

locals {
  metrics_namespace = var.project_name
}

# --- Aviso del kill switch (SNS) ----------------------------------

# El tema "alerts" (alarms.tf) solo manda correo. Este segundo tema además
# invoca a la Lambda que cierra los comentarios: solo la alarma grave (picos de
# POST) publica en él.
resource "aws_sns_topic" "killswitch" {
  #checkov:skip=CKV_AWS_26:CloudWatch no puede publicar en temas cifrados con la clave gestionada aws/sns; el mensaje solo lleva el nombre de la alarma
  name = "${var.project_name}-killswitch"
}

resource "aws_sns_topic_subscription" "killswitch_lambda" {
  topic_arn = aws_sns_topic.killswitch.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.killswitch.arn
}

resource "aws_lambda_permission" "killswitch_sns" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.killswitch.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.killswitch.arn
}

# --- Lambda del kill switch ---------------------------------------

data "archive_file" "killswitch" {
  type        = "zip"
  source_file = "${path.module}/lambda/killswitch/index.mjs"
  output_path = "${path.module}/build/killswitch.zip"
}

resource "aws_iam_role" "killswitch" {
  name               = "${var.project_name}-killswitch-lambda"
  assume_role_policy = data.aws_iam_policy_document.comments_assume.json
}

resource "aws_iam_role_policy_attachment" "killswitch_logs" {
  role       = aws_iam_role.killswitch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Permiso mínimo: escribir solo filas de la partición "#flags"
data "aws_iam_policy_document" "killswitch_db" {
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.comments.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["#flags"]
    }
  }
}

resource "aws_iam_role_policy" "killswitch_db" {
  name   = "dynamodb-flags"
  role   = aws_iam_role.killswitch.id
  policy = data.aws_iam_policy_document.killswitch_db.json
}

resource "aws_cloudwatch_log_group" "killswitch" {
  name              = "/aws/lambda/${var.project_name}-killswitch"
  retention_in_days = 14
}

resource "aws_lambda_function" "killswitch" {
  function_name = "${var.project_name}-killswitch"
  role          = aws_iam_role.killswitch.arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"
  timeout       = 5
  memory_size   = 128

  filename         = data.archive_file.killswitch.output_path
  source_code_hash = data.archive_file.killswitch.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.comments.name
    }
  }

  depends_on = [aws_cloudwatch_log_group.killswitch]
}

# --- Métrica de intentos de POST (a partir del registro de la API) --

resource "aws_cloudwatch_log_metric_filter" "post_attempts" {
  name           = "${var.project_name}-post-attempts"
  log_group_name = aws_cloudwatch_log_group.comments_api.name
  pattern        = "{ $.route = \"POST /comments\" }"

  metric_transformation {
    name      = "PostAttempts"
    namespace = local.metrics_namespace
    value     = "1"
  }
}

# --- Alarmas nuevas -----------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.project_name}-api-5xx"
  alarm_description   = "La API devuelve errores 5xx (por ejemplo, la Lambda no puede leer SSM o DynamoDB)"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiId = aws_apigatewayv2_api.comments.id
    Stage = aws_apigatewayv2_stage.default.name
  }
}

# GRAVE: demasiados intentos de comentar en poco tiempo. Avisa por correo y
# cierra los comentarios automáticamente (no se reabren solos).
resource "aws_cloudwatch_metric_alarm" "post_spike" {
  alarm_name          = "${var.project_name}-post-spike"
  alarm_description   = "Pico de intentos de POST /comments: se cierran los comentarios (kill switch)"
  namespace           = local.metrics_namespace
  metric_name         = "PostAttempts"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.post_spike_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn, aws_sns_topic.killswitch.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.post_attempts]
}

# --- Dashboard ----------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.project_name

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "alarm"
        x      = 0
        y      = 0
        width  = 24
        height = 3
        properties = {
          title = "Estado de las alarmas"
          alarms = [
            aws_cloudwatch_metric_alarm.post_spike.arn,
            aws_cloudwatch_metric_alarm.comments_traffic.arn,
            aws_cloudwatch_metric_alarm.api_5xx.arn,
            aws_cloudwatch_metric_alarm.comments_errors.arn,
            aws_cloudwatch_metric_alarm.comments_throttles.arn,
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 3
        width  = 12
        height = 6
        properties = {
          title   = "Lambda: invocaciones, errores y estrangulamientos"
          region  = data.aws_region.comments.region
          view    = "timeSeries"
          stacked = false
          period  = 300
          stat    = "Sum"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.comments.function_name],
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.comments.function_name],
            ["AWS/Lambda", "Throttles", "FunctionName", aws_lambda_function.comments.function_name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 3
        width  = 12
        height = 6
        properties = {
          title   = "Lambda: duración (ms)"
          region  = data.aws_region.comments.region
          view    = "timeSeries"
          stacked = false
          period  = 300
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.comments.function_name, { stat = "Average", label = "media" }],
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.comments.function_name, { stat = "p95", label = "p95" }],
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.comments.function_name, { stat = "Maximum", label = "máxima" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 9
        width  = 12
        height = 6
        properties = {
          title   = "API: peticiones y errores"
          region  = data.aws_region.comments.region
          view    = "timeSeries"
          stacked = false
          period  = 300
          stat    = "Sum"
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.comments.id, "Stage", aws_apigatewayv2_stage.default.name],
            ["AWS/ApiGateway", "4xx", "ApiId", aws_apigatewayv2_api.comments.id, "Stage", aws_apigatewayv2_stage.default.name],
            ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.comments.id, "Stage", aws_apigatewayv2_stage.default.name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 9
        width  = 12
        height = 6
        properties = {
          title   = "API: latencia (ms)"
          region  = data.aws_region.comments.region
          view    = "timeSeries"
          stacked = false
          period  = 300
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.comments.id, "Stage", aws_apigatewayv2_stage.default.name, { stat = "Average", label = "media" }],
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.comments.id, "Stage", aws_apigatewayv2_stage.default.name, { stat = "p95", label = "p95" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 15
        width  = 12
        height = 6
        properties = {
          title   = "Intentos de comentar (la línea roja cierra los comentarios)"
          region  = data.aws_region.comments.region
          view    = "timeSeries"
          stacked = false
          period  = 300
          stat    = "Sum"
          metrics = [
            [local.metrics_namespace, "PostAttempts"],
          ]
          annotations = {
            horizontal = [
              { label = "kill switch", value = var.post_spike_threshold, color = "#d62728" },
            ]
          }
        }
      },
      {
        type   = "text"
        x      = 12
        y      = 15
        width  = 12
        height = 6
        properties = {
          markdown = join("\n", [
            "## Kill switch de comentarios",
            "Si salta la alarma **post-spike**, los comentarios se cierran solos (leer sigue funcionando).",
            "",
            "Desde `~/zzzflix`, con la sesión de AWS activa, abre `moderate.py` y usa:",
            "- `estado`: ver si están abiertos o cerrados",
            "- `cerrar`: cerrarlos a mano",
            "- `abrir`: reabrirlos",
          ])
        }
      },
    ]
  })
}

output "dashboard_url" {
  value = "https://${data.aws_region.comments.region}.console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.comments.region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}
