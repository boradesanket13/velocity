import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app";
import { hashToken } from "../src/api/auth";
import { createLogger } from "../src/lib/logger";
import type { DeploymentRepo } from "../src/lib/store";
import { ACTIVE_STATUSES, type Deployment } from "../src/lib/types";

class MemoryRepo implements DeploymentRepo {
  items = new Map<string, Deployment>();
  async create(d: Deployment) {
    this.items.set(d.id, { ...d });
  }
  async get(id: string) {
    return this.items.get(id);
  }
  async update(id: string, patch: Partial<Deployment>) {
    const cur = this.items.get(id);
    if (cur) this.items.set(id, { ...cur, ...patch });
  }
  async listByOwner(owner: string, limit = 20) {
    return [...this.items.values()].filter((d) => d.owner === owner).slice(0, limit);
  }
  async countActive(owner: string) {
    return (await this.listByOwner(owner, 50)).filter((d) => ACTIVE_STATUSES.includes(d.status)).length;
  }
}

const ALICE = "alice-token-0123456789abcdef";
const BOB = "bob-token-0123456789abcdefgh";

describe("API", () => {
  const repo = new MemoryRepo();
  const sent: string[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = createApp({
      config: {
        SITES_URL_TEMPLATE: "http://{id}.localhost:3001",
        CORS_ORIGINS: "http://localhost:5173",
        TRUST_PROXY: 0,
        DEPLOYS_PER_MINUTE: 100,
        MAX_ACTIVE_DEPLOYMENTS_PER_OWNER: 2,
      },
      logger: createLogger("test", "silent"),
      repo,
      queue: {
        async send(body: string) {
          sent.push(body);
        },
      },
      logs: {
        async get(id: string) {
          return id === [...repo.items.keys()][0] ? "build log line" : undefined;
        },
      },
      apiKeys: new Map([
        [hashToken(ALICE), "alice"],
        [hashToken(BOB), "bob"],
      ]),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (path: string, token: string | null, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  it("serves /healthz without auth", async () => {
    const res = await call("/healthz", null);
    expect(res.status).toBe(200);
  });

  it("requires a valid API key", async () => {
    expect((await call("/v1/deployments", null)).status).toBe(401);
    expect((await call("/v1/deployments", "wrong-token-wrong-token")).status).toBe(401);
  });

  it("validates the request body", async () => {
    const res = await call("/v1/deployments", ALICE, {
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://evil.com/a/b" }),
    });
    expect(res.status).toBe(400);
  });

  it("creates a deployment, enqueues it, and hides ownership", async () => {
    const res = await call("/v1/deployments", ALICE, {
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://github.com/a/b" }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Deployment & { owner?: string };
    expect(body.status).toBe("queued");
    expect(body.owner).toBeUndefined();
    expect(body.url).toBe(`http://${body.id}.localhost:3001`);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({ deploymentId: body.id });
  });

  it("enforces the per-owner active deployment limit", async () => {
    const post = () =>
      call("/v1/deployments", ALICE, { method: "POST", body: JSON.stringify({ repoUrl: "https://github.com/a/c" }) });
    expect((await post()).status).toBe(202); // 2nd active
    expect((await post()).status).toBe(429); // limit is 2
  });

  it("only lets the owner read a deployment and its logs", async () => {
    const id = [...repo.items.keys()][0]!;
    expect((await call(`/v1/deployments/${id}`, ALICE)).status).toBe(200);
    expect((await call(`/v1/deployments/${id}`, BOB)).status).toBe(404);
    expect((await call(`/v1/deployments/${id}/logs`, BOB)).status).toBe(404);
    const logs = await call(`/v1/deployments/${id}/logs`, ALICE);
    expect(logs.status).toBe(200);
    expect(await logs.text()).toBe("build log line");
    expect((await call("/v1/deployments/not-an-id", ALICE)).status).toBe(404);
  });
});
