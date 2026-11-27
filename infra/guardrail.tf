# ---------------------------------------------------------------
# Filtro automático de comentarios: Amazon Bedrock Guardrails
#   - Si Guardrails da OK, el comentario se publica solo.
#   - Si bloquea, se rechaza. Si falla, queda pendiente.
#   - Tope propio de ejecuciones al día (guardrail_daily_cap), que la Lambda
#     comprueba ANTES de llamar. 0 apaga el filtro (todo va a revisión manual).
# El nivel Standard (alemán y español bien soportados) usa inferencia entre
# regiones: el texto puede procesarse en regiones de la UE distintas de
# Estocolmo (eu-central-1, eu-west-1, eu-west-3 o eu-north-1).
# ---------------------------------------------------------------

variable "guardrail_daily_cap" {
  description = "Máximo de ejecuciones de Guardrails al día (0 = filtro apagado, todo a revisión manual)"
  type        = number
  default     = 50

  validation {
    condition     = var.guardrail_daily_cap >= 0 && floor(var.guardrail_daily_cap) == var.guardrail_daily_cap
    error_message = "guardrail_daily_cap debe ser un entero mayor o igual que 0."
  }
}

locals {
  # DRAFT = la versión de trabajo; Terraform la actualiza al aplicar
  guardrail_version = "DRAFT"

  # Perfil de inferencia entre regiones para eu-north-1 y sus regiones destino
  guardrail_profile = "eu.guardrail.v1:0"
  guardrail_regions = ["eu-central-1", "eu-west-1", "eu-west-3", "eu-north-1"]
}

resource "aws_bedrock_guardrail" "comments" {
  name                      = "${var.project_name}-comments"
  description               = "Filtra los comentarios de zzzflix antes de publicarlos"
  blocked_input_messaging   = "Comentario bloqueado por el filtro automático."
  blocked_outputs_messaging = "Comentario bloqueado por el filtro automático."

  cross_region_config {
    guardrail_profile_identifier = "arn:aws:bedrock:${data.aws_region.comments.region}:${data.aws_caller_identity.comments.account_id}:guardrail-profile/${local.guardrail_profile}"
  }

  content_policy_config {
    tier_config {
      tier_name = "STANDARD"
    }

    filters_config {
      type            = "HATE"
      input_strength  = "HIGH"
      output_strength = "HIGH"
    }

    filters_config {
      type            = "SEXUAL"
      input_strength  = "HIGH"
      output_strength = "HIGH"
    }

    filters_config {
      type            = "VIOLENCE"
      input_strength  = "HIGH"
      output_strength = "HIGH"
    }

    filters_config {
      type            = "MISCONDUCT"
      input_strength  = "HIGH"
      output_strength = "HIGH"
    }

    # Más permisivo: una reseña dura de una película aburrida no debe bloquearse
    filters_config {
      type            = "INSULTS"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
  }

  word_policy_config {
    managed_word_lists_config {
      type = "PROFANITY"
    }
  }

  # Datos personales: no se publican correos, teléfonos, tarjetas ni IBAN
  sensitive_information_policy_config {
    pii_entities_config {
      type   = "EMAIL"
      action = "BLOCK"
    }

    pii_entities_config {
      type   = "PHONE"
      action = "BLOCK"
    }

    pii_entities_config {
      type   = "CREDIT_DEBIT_CARD_NUMBER"
      action = "BLOCK"
    }

    pii_entities_config {
      type   = "INTERNATIONAL_BANK_ACCOUNT_NUMBER"
      action = "BLOCK"
    }
  }
}

# --- Permiso mínimo de la Lambda ------------------------------------
# Solo puede aplicar ESTE guardrail (y su perfil entre regiones). Sin acceso a
# modelos ni a otros guardrails.
data "aws_iam_policy_document" "comments_guardrail" {
  statement {
    actions = ["bedrock:ApplyGuardrail"]
    resources = concat(
      [aws_bedrock_guardrail.comments.guardrail_arn],
      [
        for r in local.guardrail_regions :
        "arn:aws:bedrock:${r}:${data.aws_caller_identity.comments.account_id}:guardrail-profile/${local.guardrail_profile}"
      ],
    )
  }
}

resource "aws_iam_role_policy" "comments_guardrail" {
  name   = "bedrock-guardrail"
  role   = aws_iam_role.comments.id
  policy = data.aws_iam_policy_document.comments_guardrail.json
}

# --- Aviso de uso (a partir de los registros de la Lambda) ----------
# La Lambda escribe una línea "guardrail_call" por cada ejecución (ok, bloqueo
# o error). Si en 24 h se llega al 80 % del tope, llega un correo.
resource "aws_cloudwatch_log_metric_filter" "guardrail_calls" {
  name           = "${var.project_name}-guardrail-calls"
  log_group_name = aws_cloudwatch_log_group.comments.name
  pattern        = "\"guardrail_call\""

  metric_transformation {
    name      = "GuardrailCalls"
    namespace = local.metrics_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "guardrail_usage" {
  alarm_name          = "${var.project_name}-guardrail-80pct"
  alarm_description   = "Guardrails ha llegado al 80 % de su tope diario de ejecuciones"
  namespace           = local.metrics_namespace
  metric_name         = "GuardrailCalls"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = max(1, ceil(var.guardrail_daily_cap * 0.8))
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.guardrail_calls]
}
