output "app_url" {
  value = "https://${local.app_domain}"
}

output "api_url" {
  value = "https://${local.api_domain}"
}

output "sites_url_template" {
  value = "https://{id}.${var.sites_domain}"
}

output "initial_api_key" {
  description = "Access key for the dashboard/API (owner 'admin'). Read with: terraform output -raw initial_api_key"
  value       = random_password.initial_api_key.result
  sensitive   = true
}

output "api_keys_secret_id" {
  value = aws_secretsmanager_secret.api_keys.id
}

# ---- values to copy into GitHub (Settings > Secrets and variables > Actions > Variables) ----------

output "github_aws_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "github_variables" {
  description = "Repository variables the deploy workflow expects."
  value = {
    AWS_ROLE_ARN             = aws_iam_role.github_deploy.arn
    AWS_REGION               = var.aws_region
    ECR_BACKEND_REPOSITORY   = aws_ecr_repository.backend.name
    ECR_RUNNER_REPOSITORY    = aws_ecr_repository.runner.name
    ECS_CLUSTER              = aws_ecs_cluster.main.name
    ECS_API_SERVICE          = aws_ecs_service.api.name
    ECS_WORKER_SERVICE       = aws_ecs_service.worker.name
    FRONTEND_BUCKET          = aws_s3_bucket.frontend.bucket
    FRONTEND_DISTRIBUTION_ID = aws_cloudfront_distribution.frontend.id
    VITE_API_URL             = "https://${local.api_domain}"
  }
}

output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_runner_url" {
  value = aws_ecr_repository.runner.repository_url
}

output "builds_dlq_url" {
  value = aws_sqs_queue.builds_dlq.url
}

output "builds_queue_url" {
  value = aws_sqs_queue.builds.url
}
