import { loadApiConfig } from "../lib/config";
import { createDynamo, createS3, createSqs } from "../lib/aws";
import { createLogger } from "../lib/logger";
import { BuildQueue } from "../lib/queue";
import { DynamoDeploymentRepo } from "../lib/store";
import { createApp } from "./app";
import { parseApiKeys } from "./auth";
import { S3LogReader } from "./logs";

const config = loadApiConfig();
const logger = createLogger("api", config.LOG_LEVEL);

const app = createApp({
  config,
  logger,
  repo: new DynamoDeploymentRepo(createDynamo(config), config.DEPLOYMENTS_TABLE),
  queue: new BuildQueue(createSqs(config), { url: config.BUILD_QUEUE_URL, name: config.BUILD_QUEUE_NAME }),
  logs: new S3LogReader(createS3(config), config.ARTIFACTS_BUCKET),
  apiKeys: parseApiKeys(config.API_KEYS),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "api listening");
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close((err) => process.exit(err ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
