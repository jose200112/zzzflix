output "site_url" {
  value = "https://${local.fqdn}"
}

output "bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}
