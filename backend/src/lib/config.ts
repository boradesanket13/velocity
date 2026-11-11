import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const posInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const common = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  AWS_REGION: z.string().default("us-east-1"),
  S3_FORCE_PATH_STYLE: bool,
  SITES_BUCKET: z.string().min(1),
  ARTIFACTS_BUCKET: z.string().min(1),
};

const queueVars = {
  BUILD_QUEUE_URL: z.string().url().optional(),
  BUILD_QUEUE_NAME: z.string().min(1).optional(),
};

const needsQueue = (v: { BUILD_QUEUE_URL?: string; BUILD_QUEUE_NAME?: string }) =>
  Boolean(v.BUILD_QUEUE_URL || v.BUILD_QUEUE_NAME);
const queueMsg = { message: "set BUILD_QUEUE_URL (AWS) or BUILD_QUEUE_NAME (local emulator)" };

/* ------------------------------------------------------------------ API */

const apiSchema = z
  .object({
    ...common,
    ...queueVars,
    PORT: posInt(3000),
    DEPLOYMENTS_TABLE: z.string().min(1),
    /** "{id}" is replaced with the deployment id, e.g. https://{id}.sites.example.com */
    SITES_URL_TEMPLATE: z.string().includes("{id}"),
    /** Comma separated "name=token" pairs. Tokens must be >= 16 chars. */
    API_KEYS: z.string().min(1),
    CORS_ORIGINS: z.string().default(""),
    /** Number of reverse proxies in front of the API (1 behind an ALB). */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    DEPLOYS_PER_MINUTE: posInt(10),
    MAX_ACTIVE_DEPLOYMENTS_PER_OWNER: posInt(3),
  })
  .refine(needsQueue, queueMsg);

export type ApiConfig = z.infer<typeof apiSchema>;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parse(apiSchema, env);
}

/* ---------------------------------------------------------------- Worker */

const workerSchema = z
  .object({
    ...common,
    ...queueVars,
    DEPLOYMENTS_TABLE: z.string().min(1),
    WORKER_CONCURRENCY: posInt(2),
    BUILD_TIMEOUT_SECONDS: posInt(600),
    MAX_ARTIFACT_MB: posInt(200),
    MAX_UNPACKED_MB: posInt(500),
    MAX_FILES: posInt(20000),
    RUNNER_MODE: z.enum(["docker", "ecs"]),

    RUNNER_IMAGE: z.string().default("webhost-runner:local"),
    DOCKER_NETWORK: z.string().optional(),
    RUNNER_MEMORY_MB: posInt(2048),
    RUNNER_CPUS: z.coerce.number().positive().default(1),

    ECS_CLUSTER: z.string().optional(),
    ECS_TASK_DEFINITION: z.string().optional(),
    ECS_SUBNETS: z.string().optional(),
    ECS_SECURITY_GROUPS: z.string().optional(),
    ECS_CONTAINER_NAME: z.string().default("runner"),
    ECS_LOG_GROUP: z.string().optional(),
    ECS_LOG_STREAM_PREFIX: z.string().default("runner"),
  })
  .refine(needsQueue, queueMsg)
  .superRefine((v, ctx) => {
    if (v.RUNNER_MODE !== "ecs") return;
    for (const key of ["ECS_CLUSTER", "ECS_TASK_DEFINITION", "ECS_SUBNETS", "ECS_SECURITY_GROUPS", "ECS_LOG_GROUP"] as const) {
      if (!v[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "required when RUNNER_MODE=ecs" });
    }
  });

export type WorkerConfig = z.infer<typeof workerSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parse(workerSchema, env);
}

/* ----------------------------------------------------------- Site server */

const siteSchema = z.object({
  ...common,
  PORT: posInt(3001),
});

export type SiteConfig = z.infer<typeof siteSchema>;

export function loadSiteConfig(env: NodeJS.ProcessEnv = process.env): SiteConfig {
  return parse(siteSchema, env);
}

/* ---------------------------------------------------------------- shared */

function parse<S extends z.ZodTypeAny>(schema: S, env: NodeJS.ProcessEnv): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(config)"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

export function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
