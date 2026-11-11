

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const env = process.env;
const WORKSPACE = "/workspace";
const REPO_DIR = path.join(WORKSPACE, "repo");
const ARCHIVE = "/tmp/site.tgz";

const REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const REL_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/?$/;

const timeoutSeconds = Number(env.BUILD_TIMEOUT_SECONDS || 600);
const maxArtifactBytes = Number(env.MAX_ARTIFACT_MB || 200) * 1024 * 1024;

const log = (msg) => console.log(`[runner] ${msg}`);
const fail = (code, msg) => {
  console.error(`[runner] ERROR: ${msg}`);
  process.exit(code);
};

const repoUrl = env.REPO_URL ?? "";
const branch = env.BRANCH || undefined;
const rootDir = env.ROOT_DIR || undefined;
const outputDir = env.OUTPUT_DIR || undefined;
const uploadUrl = env.UPLOAD_URL ?? "";

if (!REPO_RE.test(repoUrl)) fail(2, "REPO_URL must be https://github.com/<owner>/<repo>");
if (branch && (!BRANCH_RE.test(branch) || branch.includes(".."))) fail(2, "invalid BRANCH");
for (const [name, value] of [["ROOT_DIR", rootDir], ["OUTPUT_DIR", outputDir]]) {
  if (value && (!REL_RE.test(value) || value.split("/").includes(".."))) fail(2, `invalid ${name}`);
}
if (!/^https?:\/\//.test(uploadUrl)) fail(2, "UPLOAD_URL missing");

let current; 
const deadline = setTimeout(() => {
  console.error(`[runner] build exceeded ${timeoutSeconds}s, aborting`);
  if (current?.pid) {
    try {
      process.kill(-current.pid, "SIGKILL");  
    } catch {}
  }
  process.exit(124);
}, timeoutSeconds * 1000);

const cleanEnv = {
  PATH: env.PATH,
  HOME: env.HOME || "/home/runner",
  CI: "true",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_AUDIT: "false",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ALLOW_PROTOCOL: "https",
};

function run(cmd, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    log(`$ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd,
      env: { ...cleanEnv, ...extraEnv },
      stdio: "inherit",
      detached: true, 
    });
    current = child;
    child.on("error", (err) => {
      console.error(`[runner] failed to start ${cmd}: ${err.message}`);
      resolve(127);
    });
    child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

function inside(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const cloneArgs = ["clone", "--depth", "1", "--single-branch", "--no-tags"];
if (branch) cloneArgs.push("--branch", branch);
cloneArgs.push("--", repoUrl, REPO_DIR);
if ((await run("git", cloneArgs, WORKSPACE)) !== 0) fail(1, "git clone failed (is the repository public and the branch correct?)");

const projectDir = rootDir ? path.resolve(REPO_DIR, rootDir) : REPO_DIR;
if (!inside(REPO_DIR, projectDir)) fail(2, "ROOT_DIR escapes the repository");
if (!existsSync(path.join(projectDir, "package.json"))) fail(2, `no package.json found in ${rootDir || "repository root"}`);


let pm = "npm";
let install = existsSync(path.join(projectDir, "package-lock.json")) ? ["ci"] : ["install"];
if (existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
  pm = "pnpm";
  install = ["install", "--frozen-lockfile"];
} else if (existsSync(path.join(projectDir, "yarn.lock"))) {
  pm = "yarn";
  install = ["install"];
}
log(`package manager: ${pm}`);

if ((await run(pm, install, projectDir)) !== 0) fail(1, "dependency installation failed");
if ((await run(pm, ["run", "build"], projectDir, { NODE_ENV: "production" })) !== 0) fail(1, "build failed");


let outDir;
if (outputDir) {
  outDir = path.resolve(projectDir, outputDir);
  if (!inside(projectDir, outDir)) fail(2, "OUTPUT_DIR escapes the project");
} else {
  const candidate = ["dist", "build", "out"].map((d) => path.join(projectDir, d)).find((d) => existsSync(path.join(d, "index.html")));
  if (!candidate) fail(3, "no index.html in dist/, build/ or out/ (set outputDir to override)");
  outDir = candidate;
}
if (!existsSync(path.join(outDir, "index.html"))) fail(3, `no index.html in ${path.relative(projectDir, outDir) || "."}`);
log(`output directory: ${path.relative(REPO_DIR, outDir)}`);


if ((await run("tar", ["-czf", ARCHIVE, "-C", outDir, "."], WORKSPACE)) !== 0) fail(1, "could not pack build output");
const size = statSync(ARCHIVE).size;
log(`archive size: ${(size / 1024 / 1024).toFixed(1)} MiB`);
if (size > maxArtifactBytes) fail(4, "build output is larger than the allowed maximum");


const uploadCode = await run(
  "curl",
  ["--fail", "--silent", "--show-error", "--retry", "3", "--retry-delay", "2", "--max-time", "300", "-X", "PUT", "--upload-file", ARCHIVE, uploadUrl],
  WORKSPACE,
);
if (uploadCode !== 0) fail(1, "could not upload the build output");

clearTimeout(deadline);
log("done");
process.exit(0);
