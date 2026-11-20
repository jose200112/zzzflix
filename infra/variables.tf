variable "aws_region" {
  description = "Región del bucket S3"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  type    = string
  default = "zzzflix"
}

variable "domain_name" {
  type    = string
  default = "josemunozmunoz.dev"
}

variable "subdomain" {
  type    = string
  default = "zzzflix"
}

variable "cloudflare_zone_id" {
  description = "Zone ID del dominio en Cloudflare (no es secreto)"
  type        = string
}

variable "flat_rate_free_plan" {
  description = "Subscribe the distribution to the CloudFront Free flat-rate plan (requires WAF)"
  type        = bool
  default     = true
}

variable "enable_waf" {
  description = "Attach AWS WAF to CloudFront"
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Email for budget alerts"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly account budget alert threshold in USD"
  type        = number
  default     = 15
}

variable "github_repo" {
  description = "GitHub repo allowed to deploy (owner/name)"
  type        = string
  default     = "jose200112/zzzflix"
}
