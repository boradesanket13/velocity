
resource "aws_dynamodb_table" "deployments" {
  name         = "${local.prefix}-deployments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "owner"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "owner-createdAt" # must match OWNER_INDEX in backend/src/lib/store.ts
    hash_key        = "owner"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  deletion_protection_enabled = var.deletion_protection
}


resource "aws_sqs_queue" "builds_dlq" {
  name                      = "${local.prefix}-builds-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "builds" {
  name                       = "${local.prefix}-builds"
  visibility_timeout_seconds = var.build_timeout_seconds + 900 # must outlive the longest build
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 86400
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.builds_dlq.arn
    maxReceiveCount     = 3 # must match MAX_ATTEMPTS in backend/src/worker/main.ts
  })
}


resource "aws_ecr_repository" "backend" {
  name                 = "${local.prefix}-backend"
  image_tag_mutability = "MUTABLE" # CI moves :latest; every build is also tagged with its commit SHA
  force_delete         = var.force_destroy

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "runner" {
  name                 = "${local.prefix}-runner"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.force_destroy

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "keep_recent" {
  for_each   = { backend = aws_ecr_repository.backend.name, runner = aws_ecr_repository.runner.name }
  repository = each.value

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}


resource "random_password" "initial_api_key" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "api_keys" {
  name                    = "${local.prefix}/api-keys"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "api_keys" {
  secret_id     = aws_secretsmanager_secret.api_keys.id
  secret_string = "admin=${random_password.initial_api_key.result}"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
