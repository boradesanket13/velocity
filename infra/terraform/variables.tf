variable "aws_region" {
  description = "Region for everything except CloudFront certificates (always us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Project name, used as a prefix for resources."
  type        = string
  default     = "webhost"
}

variable "environment" {
  description = "Environment name (prod, staging, ...)."
  type        = string
  default     = "prod"
}

variable "zone_name" {
  description = "Existing Route 53 public hosted zone for the dashboard and API (e.g. example.com)."
  type        = string
}

variable "app_subdomain" {
  description = "Subdomain of zone_name for the dashboard."
  type        = string
  default     = "app"
}

variable "api_subdomain" {
  description = "Subdomain of zone_name for the API."
  type        = string
  default     = "api"
}

variable "sites_domain" {
  description = "Domain under which deployments are served: https://<id>.<sites_domain>. Prefer a separate registrable domain."
  type        = string
}

variable "sites_zone_name" {
  description = "Existing Route 53 public hosted zone that contains sites_domain."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to assume the deploy role via OIDC."
  type        = string
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC identity provider. Set to false if it already exists in this AWS account."
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Email for CloudWatch alarms and budget alerts. Empty disables the subscription and the budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget in USD (alerts at 80% actual and 100% forecast)."
  type        = number
  default     = 150
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

# ---- compute sizing ------------------------------------------------------------------------

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "api_max_count" {
  type    = number
  default = 6
}

variable "worker_desired_count" {
  description = "Number of worker tasks. Each runs worker_concurrency builds at once."
  type        = number
  default     = 1
}

variable "worker_concurrency" {
  type    = number
  default = 2
}

variable "runner_cpu" {
  description = "Fargate CPU units for each build (1024 = 1 vCPU)."
  type        = number
  default     = 1024
}

variable "runner_memory" {
  description = "Fargate memory (MiB) for each build. Must be a valid combination with runner_cpu."
  type        = number
  default     = 2048
}

variable "build_timeout_seconds" {
  type    = number
  default = 600
}

variable "max_artifact_mb" {
  type    = number
  default = 200
}

variable "backend_image_tag" {
  description = "Image tag for the API/worker. CI pushes :latest and forces a new deployment."
  type        = string
  default     = "latest"
}

variable "runner_image_tag" {
  type    = string
  default = "latest"
}


variable "enable_waf" {
  description = "Attach an AWS WAF web ACL (rate limiting + managed rules) to the API load balancer."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Max requests per 5 minutes per IP before WAF blocks."
  type        = number
  default     = 2000
}

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "site_retention_days" {
  description = "Delete hosted deployments after N days. 0 keeps them forever."
  type        = number
  default     = 0
}

variable "deletion_protection" {
  description = "Protect the load balancer from accidental deletion."
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = "Allow `terraform destroy` to delete non-empty S3 buckets. Keep false in production."
  type        = bool
  default     = false
}
