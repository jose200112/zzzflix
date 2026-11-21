# ---------------------------------------------------------------
# Comentarios: DynamoDB + Lambda + API Gateway (HTTP API)
# Parte 1: base funcional. Los comentarios nuevos quedan "pending".
# ---------------------------------------------------------------

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

# Permisos mínimos: solo guardar y consultar en esta tabla
data "aws_iam_policy_document" "comments_db" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.comments.arn]
  }
}

resource "aws_iam_role_policy" "comments_db" {
  name   = "dynamodb"
  role   = aws_iam_role.comments.id
  policy = data.aws_iam_policy_document.comments_db.json
}

resource "aws_cloudwatch_log_group" "comments" {
  name              = "/aws/lambda/${var.project_name}-comments"
  retention_in_days = 14
}

resource "aws_lambda_function" "comments" {
  function_name = "${var.project_name}-comments"
  role          = aws_iam_role.comments.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  timeout       = 5
  memory_size   = 128

  filename         = data.archive_file.comments.output_path
  source_code_hash = data.archive_file.comments.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.comments.name
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

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.comments.id
  name        = "$default"
  auto_deploy = true

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
