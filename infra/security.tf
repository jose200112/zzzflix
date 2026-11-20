# Cabeceras de seguridad (HSTS, X-Content-Type-Options, X-Frame-Options...)
data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

# WAF para CloudFront: debe estar en us-east-1 con scope CLOUDFRONT
resource "aws_wafv2_web_acl" "site" {
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1
  name     = "${var.project_name}-waf"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = 500
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = {
      "aws-ip-reputation" = { priority = 3, name = "AWSManagedRulesAmazonIpReputationList" }
    }

    content {
      name     = rule.key
      priority = rule.value.priority

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          name        = rule.value.name
          vendor_name = "AWS"
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-waf"
    sampled_requests_enabled   = true
  }
}

# Plan de tarifa plana Free de CloudFront (0 USD, sin cargos por exceso)
resource "aws_pricingplanmanager_subscription" "site" {
  count    = var.flat_rate_free_plan ? 1 : 0
  provider = aws.us_east_1

  plan_family = "CloudFront"
  plan_tier   = "FREE"
  resource_arns = [
    aws_cloudfront_distribution.site.arn,
    aws_wafv2_web_acl.site[0].arn,
  ]

  lifecycle {
    precondition {
      condition     = var.enable_waf
      error_message = "El plan flat-rate requiere el WAF (enable_waf = true)."
    }
  }
}

# Alerta de coste (la cuenta entera, no solo zzzflix)
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
