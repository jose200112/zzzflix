terraform {
  backend "s3" {
    bucket       = "zzzflix-tfstate-191699140636"
    key          = "zzzflix/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}
