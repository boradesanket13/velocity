import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Parses API_KEYS ("alice=<token>,bob=<token>") into a map of sha256(token) -> owner.
 * Only hashes are kept in memory and lookups are by hash, so there is no
 * token-comparison timing side channel.
 *
 * This is the seam to replace with real user auth (Cognito / OIDC JWT) later:
 * all the rest of the API needs is `res.locals.owner`.
 */
export function parseApiKeys(raw: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error("API_KEYS entries must look like name=token");
    const name = pair.slice(0, eq);
    const token = pair.slice(eq + 1);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) throw new Error(`API_KEYS: invalid owner name "${name}"`);
    if (token.length < 16) throw new Error(`API_KEYS: token for "${name}" is too short (min 16 chars)`);
    const hash = hashToken(token);
    if (keys.has(hash)) throw new Error("API_KEYS: duplicate token");
    keys.set(hash, name);
  }
  if (keys.size === 0) throw new Error("API_KEYS must contain at least one key");
  return keys;
}

export function authMiddleware(keys: Map<string, string>): RequestHandler {
  return (req, res, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.header("authorization") ?? "");
    const owner = match ? keys.get(hashToken(match[1]!.trim())) : undefined;
    if (!owner) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "unauthorized" });
      return;
    }
    res.locals.owner = owner;
    next();
  };
}
