import { z } from "zod";

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export interface ParsedRepo {
  owner: string;
  repo: string;
  url: string;
}


export function parseRepoUrl(input: string): ParsedRepo | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com") return null;
  if (u.username || u.password || u.port || u.search || u.hash) return null;

  const segments = u.pathname.split("/").filter((s, i, a) => !(s === "" && (i === 0 || i === a.length - 1)));
  if (segments.length !== 2) return null;

  const owner = segments[0]!;
  let repo = segments[1]!;
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);

  for (const s of [owner, repo]) {
    if (!SEGMENT_RE.test(s) || s === "." || s === "..") return null;
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/** Relative path made of safe segments only (no "..", no absolute paths, no odd characters). */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > 200) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  const segments = p.replace(/\/$/, "").split("/");
  return segments.every((s) => SEGMENT_RE.test(s) && s !== "." && s !== "..");
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const relPath = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine(isSafeRelativePath, "must be a relative path such as 'apps/web' (no '..', no leading '/')")
    .optional(),
);

const branch = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(BRANCH_RE, "invalid branch name")
    .refine((b) => !b.includes(".."), "invalid branch name")
    .optional(),
);

export const createDeploymentSchema = z
  .object({
    repoUrl: z
      .string()
      .max(300)
      .transform((value, ctx) => {
        const parsed = parseRepoUrl(value.trim());
        if (!parsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "must be a public GitHub repository URL like https://github.com/<owner>/<repo>",
          });
          return z.NEVER;
        }
        return parsed.url;
      }),
    branch,
    rootDir: relPath,
    outputDir: relPath,
  })
  .strict();

export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;
