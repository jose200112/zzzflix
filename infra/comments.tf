# ---------------------------------------------------------------
# Comentarios: DynamoDB + Lambda + API Gateway (HTTP API)
# Parte 1: base funcional. Los comentarios nuevos quedan "pending".
# Parte 2a: topes diarios exactos e interruptor de emergencia.
# ---------------------------------------------------------------

variable "comments_enabled" {
  description = "Interruptor de emergencia: false cierra el POST de comentarios"
  type        = bool
  default     = true
}

variable "daily_comment_cap" {
  description = "Máximo de comentarios nuevos al día en total"
  type        = number
  default     = 50
}

variable "ip_comment_cap" {
  description = "Máximo de comentarios nuevos al día por IP"
  type        = number
  default     = 3
}

# La clave secreta de Turnstile vive en SSM Parameter Store (SecureString).
# Se crea a mano con la CLI para que su valor no pase nunca por Terraform ni
# por su estado; aquí solo se referencia por nombre.
locals {
  turnstile_param_name = "/${var.project_name}/turnstile-secret"
  # Sal de los hashes de IP: también se crea a mano con la CLI (aws ssm put-parameter)
  ip_salt_param_name = "/${var.project_name}/ip-salt"
}

data "aws_region" "comments" {}
data "aws_caller_identity" "comments" {}

resource "aws_dynamodb_table" "comments" {
  name         = "${var.project_name}-comments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "titleId"
  range_key    = "sk"

  attribute {
    name = "titleId"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Los contadores diarios caducan solos
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Proteccion contra borrados y copias a un punto en el tiempo.
  # Ojo: con la proteccion activa, "terraform destroy" falla hasta que se
  # pone en false y se aplica (ver README).
  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }
}

# --- Lambda -------------------------------------------------------

data "archive_file" "comments" {
  type        = "zip"
  source_file = "${path.module}/lambda/comments/index.mjs"
  output_path = "${path.module}/build/comments.zip"
}

data "aws_iam_policy_document" "comments_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "comments" {
  name               = "${var.project_name}-comments-lambda"
  assume_role_policy = data.aws_iam_policy_document.comments_assume.json
}

resource "aws_iam_role_policy_attachment" "comments_logs" {
  role       = aws_iam_role.comments.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Permisos mínimos: guardar, consultar y actualizar contadores en esta tabla
data "aws_iam_policy_document" "comments_db" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.comments.arn]
  }
}

resource "aws_iam_role_policy" "comments_db" {
  name   = "dynamodb"
  role   = aws_iam_role.comments.id
  policy = data.aws_iam_policy_document.comments_db.json
}

# Permiso mínimo: leer solo los parámetros de Turnstile y de la sal de IP
data "aws_iam_policy_document" "comments_ssm" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${data.aws_region.comments.region}:${data.aws_caller_identity.comments.account_id}:parameter${local.turnstile_param_name}",
      "arn:aws:ssm:${data.aws_region.comments.region}:${data.aws_caller_identity.comments.account_id}:parameter${local.ip_salt_param_name}",
    ]
  }
}

resource "aws_iam_role_policy" "comments_ssm" {
  name   = "ssm-turnstile"
  role   = aws_iam_role.comments.id
  policy = data.aws_iam_policy_document.comments_ssm.json
}

resource "aws_cloudwatch_log_group" "comments" {
  name              = "/aws/lambda/${var.project_name}-comments"
  retention_in_days = 14
}

resource "aws_lambda_function" "comments" {
  function_name = "${var.project_name}-comments"
  role          = aws_iam_role.comments.arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"
  timeout       = 10 # Turnstile (hasta 2,5 s) + Guardrails (hasta 4 s)
  memory_size   = 128

  filename         = data.archive_file.comments.output_path
  source_code_hash = data.archive_file.comments.output_base64sha256

  environment {
    variables = {
      TABLE_NAME             = aws_dynamodb_table.comments.name
      COMMENTS_ENABLED       = tostring(var.comments_enabled)
      DAILY_CAP              = tostring(var.daily_comment_cap)
      IP_CAP                 = tostring(var.ip_comment_cap)
      TURNSTILE_SECRET_PARAM = local.turnstile_param_name
      IP_SALT_PARAM          = local.ip_salt_param_name
      GUARDRAIL_ID           = aws_bedrock_guardrail.comments.guardrail_id
      GUARDRAIL_VERSION      = local.guardrail_version
      GUARDRAIL_CAP          = tostring(var.guardrail_daily_cap)
    }
  }

  depends_on = [aws_cloudwatch_log_group.comments]
}

# --- API Gateway (HTTP API) ---------------------------------------

resource "aws_apigatewayv2_api" "comments" {
  name          = "${var.project_name}-comments"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [
      "https://${var.subdomain}.${var.domain_name}",
      "http://localhost:5173",
    ]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "comments" {
  api_id                 = aws_apigatewayv2_api.comments.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.comments.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_comments" {
  api_id    = aws_apigatewayv2_api.comments.id
  route_key = "GET /comments"
  target    = "integrations/${aws_apigatewayv2_integration.comments.id}"
}

resource "aws_apigatewayv2_route" "post_comments" {
  api_id    = aws_apigatewayv2_api.comments.id
  route_key = "POST /comments"
  target    = "integrations/${aws_apigatewayv2_integration.comments.id}"
}

resource "aws_apigatewayv2_route" "get_ratings" {
  api_id    = aws_apigatewayv2_api.comments.id
  route_key = "GET /ratings"
  target    = "integrations/${aws_apigatewayv2_integration.comments.id}"
}

# Registro de accesos de la API (para investigar abusos).
# Incluye IPs, por eso la retencion es corta.
resource "aws_cloudwatch_log_group" "comments_api" {
  name              = "/aws/apigateway/${var.project_name}-comments"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.comments.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.comments_api.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      time             = "$context.requestTime"
      ip               = "$context.identity.sourceIp"
      method           = "$context.httpMethod"
      route            = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  # Techo de peticiones por segundo (protección básica de la parte 1)
  default_route_settings {
    throttling_burst_limit = 5
    throttling_rate_limit  = 2
  }

  route_settings {
    route_key              = "POST /comments"
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }

  depends_on = [
    aws_apigatewayv2_route.get_comments,
    aws_apigatewayv2_route.post_comments,
    aws_apigatewayv2_route.get_ratings,
  ]
}

resource "aws_lambda_permission" "comments_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.comments.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.comments.execution_arn}/*/*"
}

output "comments_api_url" {
  value = aws_apigatewayv2_api.comments.api_endpoint
}
