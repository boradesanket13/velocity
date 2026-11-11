import Docker from "dockerode";
import { RetryableError, runnerEnv, type BuildRunner, type RunnerInput, type RunnerResult } from "./types";

export interface DockerRunnerOptions {
  image: string;
  network?: string;
  memoryMb: number;
  cpus: number;
}

/**
 * Local development runner: one throwaway container per build, talking to the
 * Docker daemon through the mounted socket. Do NOT use in production (the socket
 * is root on the host); production uses EcsRunner.
 */
export class DockerRunner implements BuildRunner {
  private readonly docker = new Docker({ socketPath: "/var/run/docker.sock" });

  constructor(private readonly opts: DockerRunnerOptions) {}

  async run(input: RunnerInput): Promise<RunnerResult> {
    let container: Docker.Container;
    try {
      container = await this.docker.createContainer({
        Image: this.opts.image,
        Tty: true, // plain (non-multiplexed) log stream
        Env: Object.entries(runnerEnv(input)).map(([k, v]) => `${k}=${v}`),
        Labels: { "webhost.deployment": input.deploymentId },
        HostConfig: {
          Memory: this.opts.memoryMb * 1024 * 1024,
          MemorySwap: this.opts.memoryMb * 1024 * 1024,
          NanoCpus: Math.round(this.opts.cpus * 1e9),
          PidsLimit: 1024,
          NetworkMode: this.opts.network,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
        },
      });
    } catch (err) {
      throw new RetryableError(`could not create runner container: ${(err as Error).message}`);
    }

    let timedOut = false;
    const killer = setTimeout(
      () => {
        timedOut = true;
        container.kill().catch(() => undefined);
      },
      (input.timeoutSeconds + 30) * 1000,
    );

    try {
      await container.start();
      const { StatusCode } = await container.wait();
      const raw = (await container.logs({ stdout: true, stderr: true, follow: false, tail: 5000 })) as unknown as Buffer;
      return { exitCode: StatusCode, timedOut, logs: raw.toString("utf8") };
    } catch (err) {
      throw new RetryableError(`docker runner failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(killer);
      await container.remove({ force: true }).catch(() => undefined);
    }
  }
}
