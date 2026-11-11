import { describe, expect, it } from "vitest";
import { authMiddleware, hashToken, parseApiKeys } from "../src/api/auth";

describe("parseApiKeys", () => {
  const t1 = "a".repeat(32);
  const t2 = "b".repeat(32);

  it("parses name=token pairs into hash -> owner", () => {
    const keys = parseApiKeys(`alice=${t1}, bob=${t2}`);
    expect(keys.get(hashToken(t1))).toBe("alice");
    expect(keys.get(hashToken(t2))).toBe("bob");
    expect(keys.size).toBe(2);
  });

  it("rejects malformed, short and duplicate keys", () => {
    expect(() => parseApiKeys("nokeyhere")).toThrow();
    expect(() => parseApiKeys("alice=short")).toThrow();
    expect(() => parseApiKeys(`bad name=${t1}`)).toThrow();
    expect(() => parseApiKeys(`a=${t1},b=${t1}`)).toThrow();
    expect(() => parseApiKeys("")).toThrow();
  });
});

describe("authMiddleware", () => {
  const token = "c".repeat(32);
  const mw = authMiddleware(parseApiKeys(`carol=${token}`));

  function run(header?: string) {
    const res: any = {
      locals: {},
      statusCode: 200,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      set() {
        return this;
      },
      json() {
        return this;
      },
    };
    let nexted = false;
    mw({ header: () => header } as any, res, () => {
      nexted = true;
    });
    return { res, nexted };
  }

  it("accepts a valid bearer token and sets the owner", () => {
    const { res, nexted } = run(`Bearer ${token}`);
    expect(nexted).toBe(true);
    expect(res.locals.owner).toBe("carol");
  });

  it("rejects missing, wrong and non-bearer credentials", () => {
    for (const h of [undefined, "", `Bearer ${"d".repeat(32)}`, `Basic ${token}`, token]) {
      const { res, nexted } = run(h);
      expect(nexted).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });
});
