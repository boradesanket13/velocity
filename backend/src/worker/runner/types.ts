export interface RunnerInput {
  deploymentId: string;
  repoUrl: string;
  branch?: string;
  rootDir?: string;
  outputDir?: string;
  /** Presigned PUT URL for exactly one object: the build output archive. */
  uploadUrl: string;
  timeoutSeconds: number;
  maxArtifactMb: number;
}

export interface RunnerResult {
  exitCode: number | null;
  timedOut: boolean;
  logs: string;
}

export interface BuildRunner {
  run(input: RunnerInput): Promise<RunnerResult>;
}

/** Environment contract with runner/run.mjs. */
export function runnerEnv(input: RunnerInput): Record<string, string> {
  const env: Record<string, string> = {
    REPO_URL: input.repoUrl,
    UPLOAD_URL: input.uploadUrl,
    BUILD_TIMEOUT_SECONDS: String(input.timeoutSeconds),
    MAX_ARTIFACT_MB: String(input.maxArtifactMb),
  };
  if (input.branch) env.BRANCH = input.branch;
  if (input.rootDir) env.ROOT_DIR = input.rootDir;
  if (input.outputDir) env.OUTPUT_DIR = input.outputDir;
  return env;
}

/** Thrown for infrastructure problems that are worth retrying (as opposed to a failing build). */
export class RetryableError extends Error {}
