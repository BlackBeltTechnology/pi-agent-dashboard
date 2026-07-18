/**
 * Tunnel diagnostic checks — see change: add-tunnel-diagnostic-checks.
 *
 * Covers the four `tunnel`-section checks added to `runSharedChecks`:
 *   - zrok binary
 *   - zrok environment
 *   - zrok API reachable
 *   - tunnel runtime
 *
 * Each check is exercised through its full ok/warning matrix using the
 * test seams on `SharedChecksDeps` (no real DNS / filesystem / binary
 * lookups). Filesystem-backed env check uses HOME isolation via
 * `os.tmpdir()`-rooted home dir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runSharedChecks,
  type DoctorCheck,
  type SharedChecksDeps,
  type TunnelWatchdogStatusLike,
} from "../doctor-core.js";

function baseDeps(overrides: Partial<SharedChecksDeps> = {}): SharedChecksDeps {
  return {
    managedDir: os.tmpdir(),
    detectSystemNode: () => ({ found: true, path: "/usr/bin/node" }),
    detectPi: () => ({ found: true, path: "/usr/bin/pi", source: "system" }),
    detectOpenSpec: () => ({ found: true, path: "/usr/bin/openspec", source: "system" }),
    // Default: DNS resolves, watchdog absent (Electron-style), no zrok resolver.
    dnsLookup: async () => undefined,
    ...overrides,
  };
}

function find(checks: DoctorCheck[], name: string): DoctorCheck {
  const c = checks.find((x) => x.name === name);
  if (!c) throw new Error(`Missing check: ${name}`);
  return c;
}

// ─── zrok binary ─────────────────────────────────────────────────────

describe("zrok binary check", () => {
  it("is skipped when no resolver is provided", async () => {
    const checks = await runSharedChecks(baseDeps());
    expect(checks.find((c) => c.name === "zrok binary")).toBeUndefined();
  });

  it("reports warning when the resolver finds no binary", async () => {
    const checks = await runSharedChecks(
      baseDeps({ resolveZrokBinary: () => ({ found: false }) }),
    );
    const c = find(checks, "zrok binary");
    expect(c.status).toBe("warning");
    expect(c.section).toBe("tunnel");
    expect(c.message).toMatch(/not found/i);
  });

  it("reports ok with resolved path when the binary is found", async () => {
    const checks = await runSharedChecks(
      baseDeps({ resolveZrokBinary: () => ({ found: true, path: "/opt/homebrew/bin/zrok" }) }),
    );
    const c = find(checks, "zrok binary");
    expect(c.status).toBe("ok");
    expect(c.message).toContain("/opt/homebrew/bin/zrok");
  });
});

// ─── zrok environment ────────────────────────────────────────────────

describe("zrok environment check", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "zrok-env-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reports warning when neither env file exists", async () => {
    const checks = await runSharedChecks(baseDeps());
    const c = find(checks, "zrok environment");
    expect(c.status).toBe("warning");
    expect(c.section).toBe("tunnel");
    expect(c.detail).toMatch(/No zrok environment file/);
  });

  it("reports ok when ~/.zrok2/environment.json is valid", async () => {
    const dir = path.join(tmpHome, ".zrok2");
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, "environment.json"),
      JSON.stringify({
        api_endpoint: "https://api-v1.zrok.io",
        ziti_identity: "abc",
        zrok_token: "tok",
      }),
    );
    const checks = await runSharedChecks(baseDeps());
    const c = find(checks, "zrok environment");
    expect(c.status).toBe("ok");
    expect(c.message).toContain("v2");
  });

  it("falls back to ~/.zrok (v1) when v2 is missing", async () => {
    const dir = path.join(tmpHome, ".zrok");
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, "environment.json"),
      JSON.stringify({
        api_endpoint: "https://api-v1.zrok.io",
        ziti_identity: "abc",
        zrok_token: "tok",
      }),
    );
    const checks = await runSharedChecks(baseDeps());
    const c = find(checks, "zrok environment");
    expect(c.status).toBe("ok");
    expect(c.message).toContain("v1");
  });

  it("reports warning (does not throw) on malformed JSON", async () => {
    const dir = path.join(tmpHome, ".zrok2");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "environment.json"), "{ this is not json");
    const checks = await runSharedChecks(baseDeps());
    const c = find(checks, "zrok environment");
    expect(c.status).toBe("warning");
    expect(c.detail).toMatch(/Malformed JSON/);
  });

  it("reports warning when required fields are missing", async () => {
    const dir = path.join(tmpHome, ".zrok2");
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, "environment.json"),
      JSON.stringify({ api_endpoint: "x" }), // missing ziti_identity, zrok_token
    );
    const checks = await runSharedChecks(baseDeps());
    const c = find(checks, "zrok environment");
    expect(c.status).toBe("warning");
    expect(c.detail).toMatch(/Missing required field/);
  });
});

// ─── zrok API reachable ──────────────────────────────────────────────

describe("zrok API reachable check", () => {
  it("reports ok when DNS resolves", async () => {
    const checks = await runSharedChecks(
      baseDeps({ dnsLookup: async () => undefined }),
    );
    const c = find(checks, "zrok API reachable");
    expect(c.status).toBe("ok");
    expect(c.section).toBe("tunnel");
  });

  it("reports warning with reason when DNS fails (NXDOMAIN-style)", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        dnsLookup: async () => {
          throw new Error("getaddrinfo ENOTFOUND api-v1.zrok.io");
        },
      }),
    );
    const c = find(checks, "zrok API reachable");
    expect(c.status).toBe("warning");
    expect(c.detail).toContain("ENOTFOUND");
  });

  it("reports warning with timeout reason when DNS times out", async () => {
    const checks = await runSharedChecks(
      baseDeps({
        dnsLookup: async () => {
          throw new Error("timeout 3000ms");
        },
      }),
    );
    const c = find(checks, "zrok API reachable");
    expect(c.status).toBe("warning");
    expect(c.detail).toMatch(/timeout/);
  });
});

// ─── zrok API reachable: api-v2 host + enrolled endpoint (X8/X9) ──────
describe("zrok API reachable check (support-zrok-v2)", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "zrok-api-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });
  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("X8: probes api-v2.zrok.io and its failure text names no api-v1", async () => {
    let probed = "";
    const checks = await runSharedChecks(
      baseDeps({
        dnsLookup: async (host) => {
          probed = host;
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
    );
    const c = find(checks, "zrok API reachable");
    expect(probed).toBe("api-v2.zrok.io");
    expect(c.status).toBe("warning");
    expect(c.message).not.toContain("api-v1");
  });

  it("X9: probes the enrolled env api_endpoint host when present", async () => {
    const dir = path.join(tmpHome, ".zrok2");
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, "environment.json"),
      JSON.stringify({ api_endpoint: "https://ctrl.self-hosted.example:1280", ziti_identity: "abc", zrok_token: "tok" }),
    );
    let probed = "";
    const checks = await runSharedChecks(baseDeps({ dnsLookup: async (host) => { probed = host; } }));
    const c = find(checks, "zrok API reachable");
    expect(probed).toBe("ctrl.self-hosted.example");
    expect(c.status).toBe("ok");
  });
});

// ─── zrok version compatible (E9–E12, E3 no-spawn) ────────────────
describe("zrok version compatible check (support-zrok-v2)", () => {
  const withVersion = (found: boolean, stdout: string) =>
    baseDeps({
      resolveZrokBinary: () => (found ? { found: true, path: "/opt/bin/zrok2" } : { found: false }),
      runZrokVersion: () => ({ ok: true, stdout }),
    });

  it("E9: v2.0.4 → ok", async () => {
    const c = find(await runSharedChecks(withVersion(true, "zrok v2.0.4")), "zrok version compatible");
    expect(c.status).toBe("ok");
  });

  it("E10: v0.4.51 (v1) → warning + upgrade remedy", async () => {
    const c = find(await runSharedChecks(withVersion(true, "zrok v0.4.51")), "zrok version compatible");
    expect(c.status).toBe("warning");
    expect(c.detail ?? "").toMatch(/upgrade|zrok2/i);
  });

  it("E11: 2.0.0-rc.1 (pre-release GA major) → ok", async () => {
    const c = find(await runSharedChecks(withVersion(true, "zrok v2.0.0-rc.1")), "zrok version compatible");
    expect(c.status).toBe("ok");
  });

  it("E12: unparseable garbage → warning (unknown), no throw", async () => {
    const c = find(await runSharedChecks(withVersion(true, "not a version at all")), "zrok version compatible");
    expect(c.status).toBe("warning");
    expect(c.code).toBe("doctor.zrok_version_unknown");
  });

  it("E3: missing binary → unavailable, NEVER spawns runZrokVersion", async () => {
    const spy = vi.fn(() => ({ ok: true, stdout: "zrok v2.0.4" }));
    const checks = await runSharedChecks(
      baseDeps({ resolveZrokBinary: () => ({ found: false }), runZrokVersion: spy }),
    );
    const c = find(checks, "zrok version compatible");
    expect(c.code).toBe("doctor.zrok_version_unavailable");
    expect(c.status).not.toBe("error");
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── tunnel runtime ──────────────────────────────────────────────────

describe("tunnel runtime check", () => {
  it("reports ok 'no tunnel data available' when no watchdog dep is injected", async () => {
    const checks = await runSharedChecks(baseDeps());
    const c = find(checks, "tunnel runtime");
    expect(c.status).toBe("ok");
    expect(c.message).toMatch(/no tunnel data available/i);
  });

  it("reports ok 'no tunnel active' when watchdog returns null", async () => {
    const checks = await runSharedChecks(
      baseDeps({ getTunnelWatchdogStatus: () => null }),
    );
    const c = find(checks, "tunnel runtime");
    expect(c.status).toBe("ok");
    expect(c.message).toMatch(/no tunnel active/i);
  });

  it("reports ok when watchdog is healthy", async () => {
    const wd: TunnelWatchdogStatusLike = {
      running: true,
      intervalMs: 60_000,
      failureThreshold: 2,
      probeTimeoutMs: 10_000,
      lastProbeAt: Date.now() - 1_000,
      lastSuccessAt: Date.now() - 1_000,
      lastFailureAt: null,
      lastFailureReason: null,
      consecutiveFailures: 0,
      lastRecycleAt: null,
      recycleCount: 0,
    };
    const checks = await runSharedChecks(
      baseDeps({ getTunnelWatchdogStatus: () => wd }),
    );
    const c = find(checks, "tunnel runtime");
    expect(c.status).toBe("ok");
    expect(c.message).toMatch(/Healthy/);
  });

  it("reports warning when consecutive failures > 0", async () => {
    const wd: TunnelWatchdogStatusLike = {
      running: true,
      intervalMs: 60_000,
      failureThreshold: 2,
      probeTimeoutMs: 10_000,
      lastProbeAt: Date.now(),
      lastSuccessAt: Date.now() - 1_000,
      lastFailureAt: Date.now(),
      lastFailureReason: "http 502",
      consecutiveFailures: 1,
      lastRecycleAt: null,
      recycleCount: 0,
    };
    const checks = await runSharedChecks(
      baseDeps({ getTunnelWatchdogStatus: () => wd }),
    );
    const c = find(checks, "tunnel runtime");
    expect(c.status).toBe("warning");
    expect(c.detail).toContain("http 502");
    expect(c.detail).toMatch(/recycleCount: 0/);
  });

  it("reports warning when lastSuccessAt is stale (> intervalMs × 3)", async () => {
    const wd: TunnelWatchdogStatusLike = {
      running: true,
      intervalMs: 60_000,
      failureThreshold: 2,
      probeTimeoutMs: 10_000,
      lastProbeAt: Date.now(),
      lastSuccessAt: Date.now() - 10 * 60_000, // 10 minutes ago, threshold is 3 min
      lastFailureAt: null,
      lastFailureReason: null,
      consecutiveFailures: 0,
      lastRecycleAt: null,
      recycleCount: 0,
    };
    const checks = await runSharedChecks(
      baseDeps({ getTunnelWatchdogStatus: () => wd }),
    );
    const c = find(checks, "tunnel runtime");
    expect(c.status).toBe("warning");
    expect(c.message).toMatch(/No successful probe/);
  });

  it("reports warning when lastSuccessAt is null (never succeeded)", async () => {
    const wd: TunnelWatchdogStatusLike = {
      running: true,
      intervalMs: 60_000,
      failureThreshold: 2,
      probeTimeoutMs: 10_000,
      lastProbeAt: Date.now(),
      lastSuccessAt: null,
      lastFailureAt: Date.now(),
      lastFailureReason: "boot",
      consecutiveFailures: 0,
      lastRecycleAt: null,
      recycleCount: 0,
    };
    const checks = await runSharedChecks(
      baseDeps({ getTunnelWatchdogStatus: () => wd }),
    );
    const c = find(checks, "tunnel runtime");
    expect(c.status).toBe("warning");
  });
});

// ─── Section + suggestion stamping integration ───────────────────────

describe("tunnel checks produce stampable non-ok rows", () => {
  it("every non-ok tunnel row has a non-empty suggestion after stamping", async () => {
    const { stampSectionsAndSuggestions } = await import("../doctor-core.js");
    const checks = await runSharedChecks(
      baseDeps({
        resolveZrokBinary: () => ({ found: false }),
        dnsLookup: async () => {
          throw new Error("ENOTFOUND");
        },
        getTunnelWatchdogStatus: () => ({
          running: true,
          intervalMs: 60_000,
          failureThreshold: 2,
          probeTimeoutMs: 10_000,
          lastProbeAt: Date.now(),
          lastSuccessAt: null,
          lastFailureAt: Date.now(),
          lastFailureReason: "boot",
          consecutiveFailures: 2,
          lastRecycleAt: null,
          recycleCount: 0,
        }),
      }),
    );
    const stamped = stampSectionsAndSuggestions(checks);
    for (const c of stamped.filter((x) => x.section === "tunnel" && x.status !== "ok")) {
      expect((c.suggestion ?? "").length).toBeGreaterThan(0);
    }
  });
});
