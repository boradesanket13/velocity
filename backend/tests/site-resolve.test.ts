import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSite } from "../src/site/resolve";

const ID = "abcde12345";

describe("resolveSite (local site server)", () => {
  it("maps the root and directories to index.html", () => {
    expect(resolveSite(`${ID}.localhost:3001`, "/")?.key).toBe(`sites/${ID}/index.html`);
    expect(resolveSite(`${ID}.localhost:3001`, "/docs/")?.key).toBe(`sites/${ID}/docs/index.html`);
  });

  it("serves real files as-is", () => {
    expect(resolveSite(`${ID}.localhost`, "/assets/app.js")?.key).toBe(`sites/${ID}/assets/app.js`);
    expect(resolveSite(`${ID}.localhost`, "/a%20b.css")?.key).toBe(`sites/${ID}/a b.css`);
  });

  it("falls back to index.html for extensionless (SPA) routes", () => {
    expect(resolveSite(`${ID}.localhost`, "/dashboard/settings")?.key).toBe(`sites/${ID}/index.html`);
  });

  it("rejects bad hosts and traversal", () => {
    expect(resolveSite(undefined, "/")).toBeNull();
    expect(resolveSite("localhost:3001", "/")).toBeNull();
    expect(resolveSite("www.localhost", "/")).toBeNull();
    expect(resolveSite(`${ID}.localhost`, "/../secret")).toBeNull();
    expect(resolveSite(`${ID}.localhost`, "/%2e%2e/secret")).toBeNull();
    expect(resolveSite(`${ID}.localhost`, "/a%5Cb")).toBeNull();
    expect(resolveSite(`${ID}.localhost`, "/%E0%A4%A")).toBeNull();
  });
});

/** The production router (CloudFront Function) must behave exactly like the local one. */
describe("CloudFront site-router function", () => {
  const code = fs.readFileSync(path.join(__dirname, "../../infra/cloudfront/site-router.js"), "utf8");
  const handler = new Function(`${code}\nreturn handler;`)() as (e: unknown) => any;

  const call = (host: string | undefined, uri: string) =>
    handler({ request: { uri, headers: host ? { host: { value: host } } : {} } });

  it("rewrites to /<id>/<path> with the same rules as the local server", () => {
    const cases: Array<[string, string]> = [
      ["/", "/index.html"],
      ["/docs/", "/docs/index.html"],
      ["/assets/app.js", "/assets/app.js"],
      ["/dashboard/settings", "/index.html"],
    ];
    for (const [uri, expectedPath] of cases) {
      expect(call(`${ID}.sites.example.com`, uri).uri).toBe(`/${ID}${expectedPath}`);
      expect(resolveSite(`${ID}.sites.example.com`, uri)?.key).toBe(`sites/${ID}${expectedPath}`);
    }
  });

  it("returns 404 for bad hosts and traversal attempts", () => {
    expect(call(undefined, "/").statusCode).toBe(404);
    expect(call("www.sites.example.com", "/").statusCode).toBe(404);
    expect(call(`${ID}.sites.example.com`, "/../x").statusCode).toBe(404);
  });
});
