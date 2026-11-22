# ---------------------------------------------------------------
# Alarmas de CloudWatch para la API de comentarios.
# Avisan por correo (SNS) en minutos, antes de que lo haga el presupuesto.
# ---------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

# AWS enviará un correo de confirmación: hay que aceptarlo una vez
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# La Lambda falla (errores de código o de DynamoDB)
resource "aws_cloudwatch_metric_alarm" "comments_errors" {
  alarm_name          = "${var.project_name}-comments-errors"
  alarm_description   = "La Lambda de comentarios esta devolviendo errores"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.comments.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Se rechazan peticiones por exceso de ejecuciones simultaneas
resource "aws_cloudwatch_metric_alarm" "comments_throttles" {
  alarm_name          = "${var.project_name}-comments-throttles"
  alarm_description   = "Lambda esta rechazando peticiones por concurrencia"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.comments.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Pico anormal de peticiones a la API (cuenta tambien las que frena el throttling)
resource "aws_cloudwatch_metric_alarm" "comments_traffic" {
  alarm_name        = "${var.project_name}-comments-traffic"
  alarm_description = "Mas de 300 peticiones en 5 minutos a la API de comentarios"
  namespace         = "AWS/ApiGateway"
  metric_name       = "Count"
  dimensions = {
    ApiId = aws_apigatewayv2_api.comments.id
    Stage = aws_apigatewayv2_stage.default.name
  }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
