# El token se lee de la variable de entorno GITHUB_TOKEN
provider "github" {
  owner = "jose200112"
}

# Variables de Actions que lee el workflow de despliegue
resource "github_actions_variable" "s3_bucket" {
  repository    = "zzzflix"
  variable_name = "S3_BUCKET"
  value         = aws_s3_bucket.site.bucket
}

resource "github_actions_variable" "cf_distribution_id" {
  repository    = "zzzflix"
  variable_name = "CF_DISTRIBUTION_ID"
  value         = aws_cloudfront_distribution.site.id
}

variable "turnstile_site_key" {
  description = "Site key publica de Cloudflare Turnstile"
  type        = string
  default     = "0x4AAAAAAGLs_zWW1RjDHQ6z"
}

resource "github_actions_variable" "comments_api_url" {
  repository    = "zzzflix"
  variable_name = "COMMENTS_API_URL"
  value         = aws_apigatewayv2_api.comments.api_endpoint
}

resource "github_actions_variable" "turnstile_site_key" {
  repository    = "zzzflix"
  variable_name = "TURNSTILE_SITE_KEY"
  value         = var.turnstile_site_key
}
