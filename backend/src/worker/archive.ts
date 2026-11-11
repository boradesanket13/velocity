import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";

export class ArchiveError extends Error {}

export interface ArchiveLimits {
  maxFiles: number;
  maxUnpackedBytes: number;
}

/**
 * The archive is produced by untrusted build code, so it is validated before
 * and while extracting: only regular files and directories (no symlinks, hard
 * links, devices), no absolute or ".." paths, bounded file count and size.
 */
export async function extractArchive(archive: string, dest: string, limits: ArchiveLimits): Promise<void> {
  let files = 0;
  let bytes = 0;
  let violation: string | undefined;

  await tar.t({
    file: archive,
    onReadEntry: (entry) => {
      const p = entry.path;
      if (entry.type !== "File" && entry.type !== "Directory") {
        violation ??= `unsupported entry type ${entry.type}: ${p}`;
      }
      if (path.isAbsolute(p) || p.split("/").includes("..")) {
        violation ??= `unsafe path: ${p}`;
      }
      if (entry.type === "File") {
        files += 1;
        bytes += entry.size ?? 0;
      }
    },
  });

  if (!violation && files > limits.maxFiles) violation = `too many files (${files} > ${limits.maxFiles})`;
  if (!violation && bytes > limits.maxUnpackedBytes) violation = `unpacked size too large (${bytes} bytes)`;
  if (violation) throw new ArchiveError(`invalid build output: ${violation}`);

  await fs.mkdir(dest, { recursive: true });
  await tar.x({
    file: archive,
    cwd: dest,
    strict: true,
    preservePaths: false,
    filter: (_p, entry) => "type" in entry && (entry.type === "File" || entry.type === "Directory"),
  });
}

/** Recursively lists regular files as posix-style relative paths. */
export async function listFiles(root: string, rel = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, childRel)));
    else if (e.isFile()) out.push(childRel);
  }
  return out;
}
