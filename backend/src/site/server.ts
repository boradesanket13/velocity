import type { Readable } from "node:stream";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import express from "express";
import mime from "mime-types";
import { createS3 } from "../lib/aws";
import { loadSiteConfig } from "../lib/config";
import { createLogger } from "../lib/logger";
import { resolveSite } from "./resolve";

/**
 * Local-development replacement for CloudFront + the site-router function.
 * In production sites are served by CloudFront straight from S3 (see infra/terraform/cloudfront.tf).
 */
const cfg = loadSiteConfig();
const log = createLogger("site-server", cfg.LOG_LEVEL);
const s3 = createS3(cfg);
const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).set("Allow", "GET, HEAD").end();
    return;
  }
  const site = resolveSite(req.headers.host, req.path);
  if (!site) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: cfg.SITES_BUCKET,
        Key: site.key,
        IfNoneMatch: req.header("if-none-match"),
      }),
    );
    res.status(200);
    res.set("Content-Type", out.ContentType ?? (mime.contentType(site.key) || "application/octet-stream"));
    if (out.CacheControl) res.set("Cache-Control", out.CacheControl);
    if (out.ETag) res.set("ETag", out.ETag);
    if (out.ContentLength !== undefined) res.set("Content-Length", String(out.ContentLength));
    res.set("X-Content-Type-Options", "nosniff");

    const body = out.Body as Readable;
    body.on("error", (err) => {
      log.error({ err, key: site.key }, "stream error");
      res.destroy(err);
    });
    body.pipe(res);
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.$metadata?.httpStatusCode === 304) {
      res.status(304).end();
    } else if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.status(404).type("text/plain").send("Not found");
    } else {
      log.error({ err, key: site.key }, "failed to read object");
      res.status(502).type("text/plain").send("Bad gateway");
    }
  }
});

app.listen(cfg.PORT, () => log.info({ port: cfg.PORT }, "site server listening"));
