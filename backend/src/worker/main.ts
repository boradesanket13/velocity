import { createDynamo, createS3, createSqs } from "../lib/aws";
import { loadWorkerConfig, splitCsv } from "../lib/config";
import { createLogger } from "../lib/logger";
import { BuildQueue, type QueueMessage } from "../lib/queue";
import { DynamoDeploymentRepo } from "../lib/store";
import type { BuildJob } from "../lib/types";
import { sleep } from "../lib/util";
import { processDeployment } from "./processor";
import { DockerRunner } from "./runner/docker";
import { EcsRunner } from "./runner/ecs";
import type { BuildRunner } from "./runner/types";

/** Must match maxReceiveCount of the SQS redrive policy (infra/terraform/sqs.tf). */
const MAX_ATTEMPTS = 3;

const cfg = loadWorkerConfig();
const log = createLogger("worker", cfg.LOG_LEVEL);

const s3 = createS3(cfg);
const repo = new DynamoDeploymentRepo(createDynamo(cfg), cfg.DEPLOYMENTS_TABLE);
const queue = new BuildQueue(createSqs(cfg), { url: cfg.BUILD_QUEUE_URL, name: cfg.BUILD_QUEUE_NAME });

const runner: BuildRunner =
  cfg.RUNNER_MODE === "ecs"
    ? new EcsRunner({
        region: cfg.AWS_REGION,
        cluster: cfg.ECS_CLUSTER!,
        taskDefinition: cfg.ECS_TASK_DEFINITION!,
        subnets: splitCsv(cfg.ECS_SUBNETS),
        securityGroups: splitCsv(cfg.ECS_SECURITY_GROUPS),
        containerName: cfg.ECS_CONTAINER_NAME,
        logGroup: cfg.ECS_LOG_GROUP!,
        logStreamPrefix: cfg.ECS_LOG_STREAM_PREFIX,
      })
    : new DockerRunner({
        image: cfg.RUNNER_IMAGE,
        network: cfg.DOCKER_NETWORK,
        memoryMb: cfg.RUNNER_MEMORY_MB,
        cpus: cfg.RUNNER_CPUS,
      });

let running = true;

async function handle(msg: QueueMessage): Promise<void> {
  let job: BuildJob;
  try {
    job = JSON.parse(msg.body) as BuildJob;
    if (typeof job.deploymentId !== "string") throw new Error("missing deploymentId");
  } catch (err) {
    log.error({ err, body: msg.body }, "dropping malformed message");
    await queue.delete(msg.receiptHandle);
    return;
  }

  try {
    await processDeployment({ cfg, log, repo, s3, runner }, job.deploymentId);
    await queue.delete(msg.receiptHandle);
  } catch (err) {
    if (msg.receiveCount >= MAX_ATTEMPTS) {
      log.error({ err, deploymentId: job.deploymentId }, "giving up after repeated infrastructure errors");
      await repo
        .update(job.deploymentId, {
          status: "failed",
          error: "Infrastructure error, please try again",
          finishedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
      await queue.delete(msg.receiptHandle);
    } else {
      log.warn({ err, deploymentId: job.deploymentId, attempt: msg.receiveCount }, "retryable error, will be redelivered");
      await repo.update(job.deploymentId, { status: "queued" }).catch(() => undefined);
    }
  }
}

async function loop(n: number): Promise<void> {
  const l = log.child({ loop: n });
  while (running) {
    let msg: QueueMessage | undefined;
    try {
      msg = await queue.receive(20, cfg.BUILD_TIMEOUT_SECONDS + 600);
    } catch (err) {
      l.error({ err }, "receive failed, backing off");
      await sleep(5000);
      continue;
    }
    if (msg) await handle(msg);
  }
}

function stop(signal: string) {
  log.info({ signal }, "stop requested: finishing in-flight builds, not taking new ones");
  running = false;
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info({ mode: cfg.RUNNER_MODE, concurrency: cfg.WORKER_CONCURRENCY }, "worker started");
Promise.all(Array.from({ length: cfg.WORKER_CONCURRENCY }, (_, i) => loop(i))).then(
  () => {
    log.info("worker stopped");
    process.exit(0);
  },
  (err) => {
    log.fatal({ err }, "worker crashed");
    process.exit(1);
  },
);
