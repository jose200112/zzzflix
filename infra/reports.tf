# ---------------------------------------------------------------
# Botón de reportar: Lambda propia con un rol de IAM mínimo.
#
# Comparte tabla, API y dominio con la Lambda de comentarios, pero su rol no
# puede llamar a Bedrock, publicar comentarios ni tocar notas o baneos: solo
# lee, escribe filas "#reports" y suma contadores "#limits".
# ---------------------------------------------------------------

variable "report_ip_cap" {
  description = "Máximo de reportes al día por IP (botón de reportar)"
  type        = number
  default     = 5

  validation {
    condition     = var.report_ip_cap >= 1 && floor(var.report_ip_cap) == var.report_ip_cap
    error_message = "report_ip_cap debe ser un entero mayor o igual que 1."
  }
}

variable "daily_report_cap" {
  description = "Máximo de reportes al día en total (botón de reportar)"
  type        = number
  default     = 30

  validation {
    condition     = var.daily_report_cap >= 1 && floor(var.daily_report_cap) == var.daily_report_cap
    error_message = "daily_report_cap debe ser un entero mayor o igual que 1."
  }
}

# El zip lleva dos carpetas: la Lambda y el código común (shared/), para que
# "import ... from '../shared/common.mjs'" funcione igual en local y en AWS.
data "archive_file" "reports" {
  type        = "zip"
  output_path = "${path.module}/build/reports.zip"

  source {
    content  = file("${path.module}/lambda/reports/index.mjs")
    filename = "reports/index.mjs"
  }

  source {
    content  = file("${path.module}/lambda/shared/common.mjs")
    filename = "shared/common.mjs"
  }
}

# --- Rol de IAM ---------------------------------------------------

resource "aws_iam_role" "reports" {
  name               = "${var.project_name}-reports-lambda"
  assume_role_policy = data.aws_iam_policy_document.comments_assume.json
}

resource "aws_iam_role_policy_attachment" "reports_logs" {
  role       = aws_iam_role.reports.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Permisos mínimos sobre la tabla. La condición dynamodb:LeadingKeys limita en
# qué partición (valor de titleId) puede escribir: sin ella podría crear
# comentarios aprobados o baneos.
data "aws_iam_policy_document" "reports_db" {
  # Leer un elemento: baneos, interruptor de cierre y el comentario reportado
  statement {
    sid       = "ReadItems"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.comments.arn]
  }

  # Guardar reportes, y solo reportes
  statement {
    sid       = "WriteReports"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.comments.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["#reports"]
    }
  }

  # Sumar a los contadores diarios, y solo a ellos
  statement {
    sid       = "UpdateCounters"
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.comments.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["#limits"]
    }
  }
}

resource "aws_iam_role_policy" "reports_db" {
  name   = "dynamodb"
  role   = aws_iam_role.reports.id
  policy = data.aws_iam_policy_document.reports_db.json
}

# Leer solo los dos parámetros de SSM que usa el código común (Turnstile y sal)
data "aws_iam_policy_document" "reports_ssm" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${data.aws_region.comments.region}:${data.aws_caller_identity.comments.account_id}:parameter${local.turnstile_param_name}",
      "arn:aws:ssm:${data.aws_region.comments.region}:${data.aws_caller_identity.comments.account_id}:parameter${local.ip_salt_param_name}",
    ]
  }
}

resource "aws_iam_role_policy" "reports_ssm" {
  name   = "ssm-turnstile"
  role   = aws_iam_role.reports.id
  policy = data.aws_iam_policy_document.reports_ssm.json
}

# --- Lambda -------------------------------------------------------

resource "aws_cloudwatch_log_group" "reports" {
  name              = "/aws/lambda/${var.project_name}-reports"
  retention_in_days = 14
}

resource "aws_lambda_function" "reports" {
  function_name = "${var.project_name}-reports"
  role          = aws_iam_role.reports.arn
  runtime       = "nodejs24.x"
  handler       = "reports/index.handler"
  timeout       = 6 # Turnstile (hasta 2,5 s) + unas pocas lecturas y escrituras
  memory_size   = 128

  filename         = data.archive_file.reports.output_path
  source_code_hash = data.archive_file.reports.output_base64sha256

  environment {
    variables = {
      TABLE_NAME             = aws_dynamodb_table.comments.name
      COMMENTS_ENABLED       = tostring(var.comments_enabled)
      TURNSTILE_SECRET_PARAM = local.turnstile_param_name
      IP_SALT_PARAM          = local.ip_salt_param_name
      REPORT_IP_CAP          = tostring(var.report_ip_cap)
      REPORT_DAILY_CAP       = tostring(var.daily_report_cap)
    }
  }

  depends_on = [aws_cloudwatch_log_group.reports]
}

# --- API Gateway: misma API que los comentarios, integración propia ----

resource "aws_apigatewayv2_integration" "reports" {
  api_id                 = aws_apigatewayv2_api.comments.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.reports.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_reports" {
  api_id    = aws_apigatewayv2_api.comments.id
  route_key = "POST /reports"
  target    = "integrations/${aws_apigatewayv2_integration.reports.id}"
}

# Solo esa ruta de la API puede invocar esta Lambda (no cualquier ruta)
resource "aws_lambda_permission" "reports_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reports.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.comments.execution_arn}/*/POST/reports"
}

# La Lambda de reportes falla (errores de código o de DynamoDB)
resource "aws_cloudwatch_metric_alarm" "reports_errors" {
  alarm_name          = "${var.project_name}-reports-errors"
  alarm_description   = "La Lambda de reportes esta devolviendo errores"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.reports.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
