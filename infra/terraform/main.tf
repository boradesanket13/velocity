data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  prefix     = "${var.name}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)

  app_domain = "${var.app_subdomain}.${var.zone_name}"
  api_domain = "${var.api_subdomain}.${var.zone_name}"

  tags = {
    Project     = var.name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_route53_zone" "main" {
  name         = var.zone_name
  private_zone = false
}

data "aws_route53_zone" "sites" {
  name         = var.sites_zone_name
  private_zone = false
}
