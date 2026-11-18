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
