resource "aws_ecs_cluster" "main" {
  name = local.prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.prefix}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.prefix}/worker"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "runner" {
  name              = "/ecs/${local.prefix}/runner"
  retention_in_days = var.log_retention_days
}

locals {
  backend_image = "${aws_ecr_repository.backend.repository_url}:${var.backend_image_tag}"
  runner_image  = "${aws_ecr_repository.runner.repository_url}:${var.runner_image_tag}"

  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "SITES_BUCKET", value = aws_s3_bucket.sites.bucket },
    { name = "ARTIFACTS_BUCKET", value = aws_s3_bucket.artifacts.bucket },
    { name = "DEPLOYMENTS_TABLE", value = aws_dynamodb_table.deployments.name },
    { name = "BUILD_QUEUE_URL", value = aws_sqs_queue.builds.url },
  ]
}

# ---- API -------------------------------------------------------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api.arn

  container_definitions = jsonencode([{
    name                   = "api"
    image                  = local.backend_image
    essential              = true
    command                = ["node", "dist/api/server.js"]
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = concat(local.common_env, [
      { name = "PORT", value = "3000" },
      { name = "SITES_URL_TEMPLATE", value = "https://{id}.${var.sites_domain}" },
      { name = "CORS_ORIGINS", value = "https://${local.app_domain}" },
      { name = "TRUST_PROXY", value = "1" },
    ])
    secrets = [{ name = "API_KEYS", valueFrom = aws_secretsmanager_secret.api_keys.arn }]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 30
  enable_execute_command            = false

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count] # managed by autoscaling
  }

  depends_on = [aws_lb_listener.https, aws_secretsmanager_secret_version.api_keys]
}

resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.api_max_count
  min_capacity       = var.api_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.prefix}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ---- worker (trusted: orchestrates builds, publishes results) ------------------------------------------------

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker.arn

  container_definitions = jsonencode([{
    name        = "worker"
    image       = local.backend_image
    essential   = true
    command     = ["node", "dist/worker/main.js"]
    stopTimeout = 120
    environment = concat(local.common_env, [
      { name = "RUNNER_MODE", value = "ecs" },
      { name = "WORKER_CONCURRENCY", value = tostring(var.worker_concurrency) },
      { name = "BUILD_TIMEOUT_SECONDS", value = tostring(var.build_timeout_seconds) },
      { name = "MAX_ARTIFACT_MB", value = tostring(var.max_artifact_mb) },
      { name = "ECS_CLUSTER", value = aws_ecs_cluster.main.name },
      { name = "ECS_TASK_DEFINITION", value = aws_ecs_task_definition.runner.family },
      { name = "ECS_SUBNETS", value = join(",", aws_subnet.private[*].id) },
      { name = "ECS_SECURITY_GROUPS", value = aws_security_group.runner.id },
      { name = "ECS_CONTAINER_NAME", value = "runner" },
      { name = "ECS_LOG_GROUP", value = aws_cloudwatch_log_group.runner.name },
      { name = "ECS_LOG_STREAM_PREFIX", value = "runner" },
    ])
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.worker.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

# ---- runner (UNTRUSTED code runs here; one task per build, launched by the worker) ------------------------------

resource "aws_ecs_task_definition" "runner" {
  family                   = "${local.prefix}-runner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.runner_cpu)
  memory                   = tostring(var.runner_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  # No task_role_arn on purpose: the build has no AWS identity.

  ephemeral_storage {
    size_in_gib = 30
  }

  container_definitions = jsonencode([{
    name      = "runner"
    image     = local.runner_image
    essential = true
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.runner.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "runner"
      }
    }
  }])
}
