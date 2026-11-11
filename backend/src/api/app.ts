import cors from "cors";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import { splitCsv, type ApiConfig } from "../lib/config";
import { isDeploymentId, newDeploymentId } from "../lib/ids";
import type { Logger } from "../lib/logger";
import type { BuildQueueSender } from "../lib/queue";
import type { DeploymentRepo } from "../lib/store";
import { toPublic, type BuildJob, type Deployment } from "../lib/types";
import { createDeploymentSchema } from "../lib/validation";
import { authMiddleware } from "./auth";
import { HttpError } from "./errors";
import type { LogReader } from "./logs";

export interface AppDeps {
  config: Pick<
    ApiConfig,
    "SITES_URL_TEMPLATE" | "CORS_ORIGINS" | "TRUST_PROXY" | "DEPLOYS_PER_MINUTE" | "MAX_ACTIVE_DEPLOYMENTS_PER_OWNER"
  >;
  logger: Logger;
  repo: DeploymentRepo;
  queue: BuildQueueSender;
  logs: LogReader;
  /** sha256(token) -> owner */
  apiKeys: Map<string, string>;
}

const handler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function createApp(deps: AppDeps): Express {
  const { config, logger, repo, queue, logs } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));
  app.use(helmet());

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(
    cors({
      origin: splitCsv(config.CORS_ORIGINS),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "10kb" }));

  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

  const v1 = express.Router();
  v1.use(authMiddleware(deps.apiKeys));

  const deployLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.DEPLOYS_PER_MINUTE,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (_req, res) => String(res.locals.owner),
    message: { error: "too many deployments, slow down" },
  });

  v1.post(
    "/deployments",
    deployLimiter,
    handler(async (req, res) => {
      const input = createDeploymentSchema.parse(req.body);
      const owner = String(res.locals.owner);

      const active = await repo.countActive(owner);
      if (active >= config.MAX_ACTIVE_DEPLOYMENTS_PER_OWNER) {
        throw new HttpError(429, "too many deployments in progress, wait for one to finish");
      }

      const now = new Date().toISOString();
      const id = newDeploymentId();
      const deployment: Deployment = {
        id,
        owner,
        repoUrl: input.repoUrl,
        branch: input.branch,
        rootDir: input.rootDir,
        outputDir: input.outputDir,
        status: "queued",
        url: config.SITES_URL_TEMPLATE.replace("{id}", id),
        createdAt: now,
        updatedAt: now,
      };
      await repo.create(deployment);

      try {
        const job: BuildJob = { deploymentId: id };
        await queue.send(JSON.stringify(job));
      } catch (err) {
        req.log.error({ err, deploymentId: id }, "failed to enqueue build");
        await repo.update(id, { status: "failed", error: "could not queue the build, please retry" }).catch(() => undefined);
        throw new HttpError(503, "could not queue the build, please retry");
      }

      res.status(202).json(toPublic(deployment));
    }),
  );

  v1.get(
    "/deployments",
    handler(async (_req, res) => {
      const items = await repo.listByOwner(String(res.locals.owner), 20);
      res.json({ items: items.map(toPublic) });
    }),
  );

  const loadOwned = async (id: string, res: Response): Promise<Deployment> => {
    if (!isDeploymentId(id)) throw new HttpError(404, "deployment not found");
    const d = await repo.get(id);
    if (!d || d.owner !== res.locals.owner) throw new HttpError(404, "deployment not found");
    return d;
  };

  v1.get(
    "/deployments/:id",
    handler(async (req, res) => {
      res.json(toPublic(await loadOwned(String(req.params.id), res)));
    }),
  );

  v1.get(
    "/deployments/:id/logs",
    handler(async (req, res) => {
      const d = await loadOwned(String(req.params.id), res);
      const text = await logs.get(d.id);
      if (text === undefined) throw new HttpError(404, "logs not available yet");
      res.type("text/plain; charset=utf-8").send(text);
    }),
  );

  app.use("/v1", v1);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: "invalid request",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const type = (err as { type?: string } | null)?.type;
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid JSON body" });
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "request body too large" });
      return;
    }
    req.log.error({ err }, "unhandled error");
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
