import { CloudWatchLogsClient, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeTasksCommand, ECSClient, RunTaskCommand, StopTaskCommand, type Task } from "@aws-sdk/client-ecs";
import { sleep } from "../../lib/util";
import { RetryableError, runnerEnv, type BuildRunner, type RunnerInput, type RunnerResult } from "./types";

export interface EcsRunnerOptions {
  region: string;
  cluster: string;
  taskDefinition: string;
  subnets: string[];
  securityGroups: string[];
  containerName: string;
  logGroup: string;
  logStreamPrefix: string;
}

/**
 * Production runner: one Fargate task per build. The task has no IAM task role
 * (nothing to steal from the metadata endpoint), sits in a private subnet with a
 * security group that has no inbound rules, and is hard-limited in CPU, memory
 * and time. It can only upload one object, through the presigned URL.
 */
export class EcsRunner implements BuildRunner {
  private readonly ecs: ECSClient;
  private readonly logs: CloudWatchLogsClient;

  constructor(private readonly opts: EcsRunnerOptions) {
    this.ecs = new ECSClient({ region: opts.region });
    this.logs = new CloudWatchLogsClient({ region: opts.region });
  }

  async run(input: RunnerInput): Promise<RunnerResult> {
    const started = await this.ecs
      .send(
        new RunTaskCommand({
          cluster: this.opts.cluster,
          taskDefinition: this.opts.taskDefinition,
          launchType: "FARGATE",
          count: 1,
          startedBy: "webhost-worker",
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: this.opts.subnets,
              securityGroups: this.opts.securityGroups,
              assignPublicIp: "DISABLED",
            },
          },
          overrides: {
            containerOverrides: [
              {
                name: this.opts.containerName,
                environment: Object.entries(runnerEnv(input)).map(([name, value]) => ({ name, value })),
              },
            ],
          },
          tags: [{ key: "deployment", value: input.deploymentId }],
        }),
      )
      .catch((err: Error) => {
        throw new RetryableError(`RunTask failed: ${err.message}`);
      });

    const taskArn = started.tasks?.[0]?.taskArn;
    if (!taskArn) {
      const reason = started.failures?.map((f) => `${f.arn ?? ""} ${f.reason ?? ""}`).join("; ");
      throw new RetryableError(`RunTask returned no task: ${reason}`);
    }
    const taskId = taskArn.split("/").pop()!;

    // Fargate needs time to provision and pull the image, which does not count against the build.
    const deadline = Date.now() + (input.timeoutSeconds + 180) * 1000;
    let task: Task | undefined;
    let timedOut = false;

    for (;;) {
      await sleep(5000);
      const out = await this.ecs
        .send(new DescribeTasksCommand({ cluster: this.opts.cluster, tasks: [taskArn] }))
        .catch(() => undefined); // transient API errors: keep polling until the deadline
      task = out?.tasks?.[0] ?? task;
      if (task?.lastStatus === "STOPPED") break;
      if (Date.now() > deadline) {
        timedOut = true;
        await this.ecs
          .send(new StopTaskCommand({ cluster: this.opts.cluster, task: taskArn, reason: "build timeout" }))
          .catch(() => undefined);
        break;
      }
    }

    const container = task?.containers?.find((c) => c.name === this.opts.containerName);
    const exitCode = container?.exitCode ?? null;
    const logs = await this.readLogs(taskId).catch((err: Error) => `(could not read logs: ${err.message})`);

    if (!timedOut && exitCode === null) {
      // e.g. image pull failure or capacity problem: infrastructure, not the user's build.
      throw new RetryableError(`task stopped without exit code: ${task?.stoppedReason ?? "unknown reason"}`);
    }
    return { exitCode, timedOut, logs };
  }

  private async readLogs(taskId: string): Promise<string> {
    const logStreamName = `${this.opts.logStreamPrefix}/${this.opts.containerName}/${taskId}`;
    const lines: string[] = [];
    let token: string | undefined;
    // CloudWatch ingestion is slightly delayed: give it a moment after the task stops.
    await sleep(3000);
    for (let page = 0; page < 20; page++) {
      const out = await this.logs.send(
        new GetLogEventsCommand({ logGroupName: this.opts.logGroup, logStreamName, startFromHead: true, nextToken: token }),
      );
      for (const e of out.events ?? []) lines.push(e.message ?? "");
      if (!out.nextForwardToken || out.nextForwardToken === token) break;
      token = out.nextForwardToken;
    }
    return lines.join("\n");
  }
}
