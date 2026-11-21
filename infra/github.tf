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
