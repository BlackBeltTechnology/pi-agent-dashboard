/**
 * /api/health.runtime block (D10). test-plan E20.
 * See change: electron-runtime-overlay-updates.
 */
import { describe, expect, it } from "vitest";
import { buildRuntimeHealth, redactRuntimeHealth } from "../runtime-overlay/runtime-health.js";

type Origin = "bundled" | "overlay" | "local" | "devMonorepo" | "npmGlobal";

function envFor(starter: string, origin: Origin): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { DASHBOARD_STARTER: starter };
  if (starter === "Electron" && origin !== "npmGlobal") {
    env.PI_DASHBOARD_RUNTIME_ORIGIN = origin;
    env.PI_DASHBOARD_RUNTIME_ID = origin === "overlay" ? "0.9.1" : origin === "local" ? "local:/r/co" : origin;
  }
  return env;
}

describe("buildRuntimeHealth (E20)", () => {
  const rows: Array<[string, Origin, boolean]> = [];
  for (const starter of ["Electron", "Standalone", "Bridge"])
    for (const origin of ["bundled", "overlay", "local", "devMonorepo", "npmGlobal"] as const)
      for (const withFailure of [true, false]) rows.push([starter, origin, withFailure]);

  it.each(rows)("starter=%s origin=%s lastFailure=%s", (starter, origin, withFailure) => {
    const rt = buildRuntimeHealth({
      env: envFor(starter, origin),
      serverVersion: "0.9.1",
      readRequest: () => ({ source: "npm", channel: "beta", sourceEpoch: "0b6c1f3e-2d4a-4c5b-9e8f-1a2b3c4d5e6f", sourceSeq: 1 }),
      readState: () => (withFailure ? { lastFailure: { id: "0.9.2", reason: "health timeout" } } : {}),
      localSnapshot: () => ({ gitSha: "abc123", dirty: true }),
    });
    const electron = starter === "Electron";
    const effectiveOrigin: Origin = electron && origin !== "npmGlobal" ? origin : "npmGlobal";
    expect(rt.origin).toBe(effectiveOrigin);
    expect(rt.updatable).toBe(electron && effectiveOrigin !== "devMonorepo" && effectiveOrigin !== "npmGlobal");
    expect(rt.version).toBe("0.9.1");
    if (electron) {
      expect(rt.lastFailure).toEqual(withFailure ? { id: "0.9.2", reason: "health timeout" } : undefined);
      expect(rt.source).toBe("npm");
      expect(rt.channel).toBe("beta");
    } else {
      expect(rt.lastFailure).toBeUndefined();
      expect(rt.source).toBeUndefined();
    }
    if (effectiveOrigin === "local") {
      expect(rt).toMatchObject({ id: "local:/r/co", gitSha: "abc123", dirty: true });
    } else {
      expect(rt.gitSha).toBeUndefined();
    }
  });

  it("never throws on unreadable state files", () => {
    const rt = buildRuntimeHealth({
      env: envFor("Electron", "overlay"),
      serverVersion: "0.9.1",
      readRequest: () => {
        throw new Error("EACCES");
      },
      readState: () => {
        throw new Error("EACCES");
      },
    });
    expect(rt).toMatchObject({ origin: "overlay", id: "0.9.1", updatable: true });
  });
});

describe("redactRuntimeHealth (unauthenticated, non-local /api/health callers)", () => {
  it("drops the local path, git identity and failure details; keeps what the UI badge needs", () => {
    const full = buildRuntimeHealth({
      env: {
        DASHBOARD_STARTER: "Electron",
        PI_DASHBOARD_RUNTIME_ORIGIN: "local",
        PI_DASHBOARD_RUNTIME_ID: "local:/Users/me/secret-co",
        PI_DASHBOARD_ELECTRON_INSTANCE: "tok-1",
      },
      serverVersion: "0.9.1",
      readRequest: () => ({ source: "bundled", sourceEpoch: "0b6c1f3e-2d4a-4c5b-9e8f-1a2b3c4d5e6f", sourceSeq: 1 }),
      readState: () => ({ lastFailure: { id: "local:/Users/me/secret-co", reason: "missing_file /Users/me/secret-co/x" } }),
      localSnapshot: () => ({ gitSha: "abc123", dirty: true }),
    });
    expect(full.owner).toBe("tok-1");
    const red = redactRuntimeHealth(full);
    expect(JSON.stringify(red)).not.toContain("/Users/me");
    expect(red).not.toHaveProperty("gitSha");
    expect(red).not.toHaveProperty("dirty");
    expect(red).not.toHaveProperty("lastFailure");
    expect(red).not.toHaveProperty("owner");
    expect(red).toMatchObject({ origin: "local", id: "local", version: "0.9.1", updatable: true });
  });

  it("keeps a version-shaped overlay id", () => {
    const full = buildRuntimeHealth({
      env: { DASHBOARD_STARTER: "Electron", PI_DASHBOARD_RUNTIME_ORIGIN: "overlay", PI_DASHBOARD_RUNTIME_ID: "0.9.1" },
      serverVersion: "0.9.1",
      readRequest: () => null,
      readState: () => ({}),
    });
    expect(redactRuntimeHealth(full).id).toBe("0.9.1");
  });
});
