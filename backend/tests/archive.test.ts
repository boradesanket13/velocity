import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArchiveError, extractArchive, listFiles } from "../src/worker/archive";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "archive-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeArchive(setup: (dir: string) => Promise<void>): Promise<string> {
  const src = path.join(tmp, "src");
  await fs.mkdir(src, { recursive: true });
  await setup(src);
  const file = path.join(tmp, "out.tgz");
  await tar.c({ file, gzip: true, cwd: src }, ["."]);
  return file;
}

const limits = { maxFiles: 100, maxUnpackedBytes: 1024 * 1024 };

describe("extractArchive", () => {
  it("extracts regular files and directories", async () => {
    const archive = await makeArchive(async (d) => {
      await fs.writeFile(path.join(d, "index.html"), "<h1>hi</h1>");
      await fs.mkdir(path.join(d, "assets"));
      await fs.writeFile(path.join(d, "assets", "app.js"), "console.log(1)");
    });
    const dest = path.join(tmp, "dest");
    await extractArchive(archive, dest, limits);
    expect((await listFiles(dest)).sort()).toEqual(["assets/app.js", "index.html"]);
  });

  it("rejects archives containing symlinks", async () => {
    const archive = await makeArchive(async (d) => {
      await fs.writeFile(path.join(d, "index.html"), "x");
      await fs.symlink("/etc/passwd", path.join(d, "leak"));
    });
    await expect(extractArchive(archive, path.join(tmp, "dest"), limits)).rejects.toBeInstanceOf(ArchiveError);
  });

  it("enforces file count and unpacked size limits", async () => {
    const archive = await makeArchive(async (d) => {
      for (let i = 0; i < 5; i++) await fs.writeFile(path.join(d, `f${i}.txt`), "x".repeat(100));
    });
    await expect(extractArchive(archive, path.join(tmp, "d1"), { ...limits, maxFiles: 3 })).rejects.toBeInstanceOf(ArchiveError);
    await expect(extractArchive(archive, path.join(tmp, "d2"), { ...limits, maxUnpackedBytes: 200 })).rejects.toBeInstanceOf(
      ArchiveError,
    );
  });
});
