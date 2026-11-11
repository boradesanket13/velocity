import path from "node:path";
import { DEPLOYMENT_ID_RE } from "../lib/ids";

export interface ResolvedSite {
  id: string;
  /** Object key inside the sites bucket. */
  key: string;
}

/**
 * Maps (Host header, URL path) to an object key. This mirrors
 * infra/cloudfront/site-router.js so local behaviour matches production:
 *   - "<id>.<anything>"  -> deployment id is the first host label
 *   - trailing "/"        -> index.html
 *   - no file extension   -> /index.html (single page app fallback)
 */
export function resolveSite(host: string | undefined, urlPath: string): ResolvedSite | null {
  if (!host) return null;
  const hostname = host.toLowerCase().split(":")[0]!;
  const id = hostname.split(".")[0]!;
  if (!DEPLOYMENT_ID_RE.test(id)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  if (decoded.split("/").includes("..")) return null;

  let p = path.posix.normalize(decoded.startsWith("/") ? decoded : `/${decoded}`);
  if (decoded.endsWith("/") || p === "/") {
    p = p.endsWith("/") ? `${p}index.html` : `${p}/index.html`;
  } else {
    const last = p.split("/").pop()!;
    if (!/\.[A-Za-z0-9]+$/.test(last)) p = "/index.html";
  }
  return { id, key: `sites/${id}${p}` };
}
