import { describe, expect, it } from "vitest";
import { DEPLOYMENT_ID_LENGTH, isDeploymentId, newDeploymentId } from "../src/lib/ids";

describe("deployment ids", () => {
  it("are DNS-safe and the expected length", () => {
    for (let i = 0; i < 200; i++) {
      const id = newDeploymentId();
      expect(id).toHaveLength(DEPLOYMENT_ID_LENGTH);
      expect(isDeploymentId(id)).toBe(true);
    }
  });

  it("do not collide in a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newDeploymentId());
    expect(seen.size).toBe(5000);
  });

  it("rejects anything that is not a generated id", () => {
    for (const bad of ["", "short", "UPPERCASE1", "has-dash12", "../../etc/x", "abcdefghijk"]) {
      expect(isDeploymentId(bad)).toBe(false);
    }
  });
});
