import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import mime from "mime-types";
import { logKey } from "../api/logs";
import type { WorkerConfig } from "../lib/config";
import type { Logger } from "../lib/logger";
import type { DeploymentRepo } from "../lib/store";
import { mapLimit, truncateTail } from "../lib/util";
import { ArchiveError, extractArchive, listFiles } from "./archive";
import { RetryableError, type BuildRunner } from "./runner/types";

/** A deterministic failure: the user's build is broken. Retrying will not help. */
export class BuildFailure extends Error {}

export interface ProcessorDeps {
  cfg: Pick<
    WorkerConfig,
    | "SITES_BUCKET"
    | "ARTIFACTS_BUCKET"
    | "BUILD_TIMEOUT_SECONDS"
    | "MAX_ARTIFACT_MB"
    | "MAX_UNPACKED_MB"
    | "MAX_FILES"
  >;
  log: Logger;
  repo: DeploymentRepo;
  s3: S3Client;
  runner: BuildRunner;
}

const MAX_LOG_BYTES = 256 * 1024;
const UPLOAD_CONCURRENCY = 16;
const STREAM_THRESHOLD_BYTES = 5 * 1024 * 1024;

const EXIT_REASONS: Record<number, string> = {
  1: "the build command failed (see build logs)",
  2: "invalid build configuration",
  3: "build finished but no index.html was found in the output directory",
  4: "build output is too large",
  124: "the build timed out",
  137: "the build was killed (probably out of memory)",
};

export const artifactKey = (id: string) => `artifacts/${id}.tgz`;
export const siteKey = (id: string, rel: string) => `sites/${id}/${rel}`;

/**
 * Runs one deployment end to end. Resolves when the deployment reached a final
 * state (deployed or failed). Throws only for problems worth retrying
 * (RetryableError, or a transient datastore error): the caller leaves the queue
 * message alone so SQS redelivers it.
 */
export async function processDeployment(deps: ProcessorDeps, id: string): Promise<void> {
  const { cfg, repo, s3, runner } = deps;
  const log = deps.log.child({ deploymentId: id });

  const deployment = await repo.get(id);
  if (!deployment) {
    log.warn("deployment not found, dropping job");
    return;
  }
  if (deployment.status === "deployed" || deployment.status === "failed") {
    log.info({ status: deployment.status }, "deployment already finished, dropping job");
    return;
  }

  await repo.update(id, { status: "building", startedAt: new Date().toISOString() });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `deploy-${id}-`));
  let publishStarted = false;

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: cfg.ARTIFACTS_BUCKET, Key: artifactKey(id) }),
      { expiresIn: cfg.BUILD_TIMEOUT_SECONDS + 900 },
    );

    log.info({ repo: deployment.repoUrl }, "starting build");
    const result = await runner.run({
      deploymentId: id,
      repoUrl: deployment.repoUrl,
      branch: deployment.branch,
      rootDir: deployment.rootDir,
      outputDir: deployment.outputDir,
      uploadUrl,
      timeoutSeconds: cfg.BUILD_TIMEOUT_SECONDS,
      maxArtifactMb: cfg.MAX_ARTIFACT_MB,
    });

    await saveLogs(s3, cfg.ARTIFACTS_BUCKET, id, result.logs.split(uploadUrl).join("[redacted]"), log);

    if (result.timedOut) throw new BuildFailure(`the build timed out after ${cfg.BUILD_TIMEOUT_SECONDS}s`);
    if (result.exitCode !== 0) {
      throw new BuildFailure(EXIT_REASONS[result.exitCode ?? -1] ?? `the build exited with code ${result.exitCode}`);
    }

    await repo.update(id, { status: "uploading" });

    const archive = path.join(workDir, "site.tgz");
    await downloadArtifact(s3, cfg.ARTIFACTS_BUCKET, artifactKey(id), archive, cfg.MAX_ARTIFACT_MB * 1024 * 1024);

    const siteDir = path.join(workDir, "site");
    await extractArchive(archive, siteDir, {
      maxFiles: cfg.MAX_FILES,
      maxUnpackedBytes: cfg.MAX_UNPACKED_MB * 1024 * 1024,
    });

    const files = await listFiles(siteDir);
    if (!files.includes("index.html")) throw new BuildFailure(EXIT_REASONS[3]!);

    publishStarted = true;
    await publishSite(s3, cfg.SITES_BUCKET, id, siteDir, files);

    await repo.update(id, { status: "deployed", finishedAt: new Date().toISOString() });
    log.info({ files: files.length }, "deployed");
  } catch (err) {
    if (err instanceof RetryableError) throw err;

    const message =
      err instanceof BuildFailure || err instanceof ArchiveError ? capitalise(err.message) : "Internal error while deploying";
    if (message === "Internal error while deploying") log.error({ err }, "deployment failed unexpectedly");
    else log.warn({ reason: message }, "deployment failed");

    if (publishStarted) await deletePrefix(s3, cfg.SITES_BUCKET, `sites/${id}/`).catch(() => undefined);
    await repo.update(id, { status: "failed", error: message, finishedAt: new Date().toISOString() });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await s3
      .send(new DeleteObjectCommand({ Bucket: cfg.ARTIFACTS_BUCKET, Key: artifactKey(id) }))
      .catch(() => undefined);
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function saveLogs(s3: S3Client, bucket: string, id: string, logs: string, log: Logger): Promise<void> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: logKey(id),
        Body: truncateTail(logs, MAX_LOG_BYTES),
        ContentType: "text/plain; charset=utf-8",
      }),
    );
  } catch (err) {
    log.warn({ err }, "could not save build logs"); // never fail a deployment because of logs
  }
}

async function downloadArtifact(s3: S3Client, bucket: string, key: string, dest: string, maxBytes: number): Promise<void> {
  let size: number;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    size = head.ContentLength ?? 0;
  } catch {
    throw new BuildFailure("the build finished but did not produce an output archive");
  }
  if (size > maxBytes) throw new BuildFailure(EXIT_REASONS[4]!);

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(obj.Body as Readable, createWriteStream(dest));
}

function cacheControlFor(rel: string): string {
  // Every deployment lives on its own immutable hostname, so assets can be cached
  // for a year. HTML is always revalidated.
  return /\.html?$/i.test(rel) ? "public, max-age=0, must-revalidate" : "public, max-age=31536000, immutable";
}

async function publishSite(s3: S3Client, bucket: string, id: string, siteDir: string, files: string[]): Promise<void> {
  await mapLimit(files, UPLOAD_CONCURRENCY, async (rel) => {
    const abs = path.join(siteDir, rel);
    const { size } = await fs.stat(abs);
    // Small files are buffered (safe to retry); large ones are streamed.
    const body = size <= STREAM_THRESHOLD_BYTES ? await fs.readFile(abs) : createReadStream(abs);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: siteKey(id, rel),
        Body: body,
        ContentLength: size,
        ContentType: mime.contentType(rel) || "application/octet-stream",
        CacheControl: cacheControlFor(rel),
      }),
    );
  });
}

async function deletePrefix(s3: S3Client, bucket: string, prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
    }
    token = page.NextContinuationToken;
  } while (token);
}
