/**
 * `classifyDashboardPort` — the one read-only port verdict behind `start` / `status`.
 * See change: harden-dashboard-start-detection (D2; test-plan E5-E7, E9, E10, P1).
 */

import type { DashboardStatus } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLASSIFY_PROBE_OPTS,
  type ClassifyDeps,
  classifyDashboardPort,
  classifyHosts,
} from "../lifecycle/classify-dashboard-port.js";
import type { LockMetadata } from "../lifecycle/home-lock.js";
import { collectOwnedPids } from "../lifecycle/stop-ownership.js";

const P = 18555;
const cfg = { port: P, piPort: 18556, host: "" };
const NOW = 1_800_000_000_000;

const meta = (over: Partial<LockMetadata> = {}): LockMetadata => ({
  pid: 4242, ppid: 1, httpPort: P, piPort: 18556, startedAt: NOW - 120_000,
  identity: "i", version: "0", url: "u", hostname: "h", ...over,
});

const REFUSED: DashboardStatus = { running: false };
const SILENT: DashboardStatus = { running: false, timedOut: true };

function deps(over: Partial<ClassifyDeps> & { byHost?: Record<string, DashboardStatus> } = {}): ClassifyDeps {
  const { byHost, ...rest } = over;
  return {
    probe: vi.fn(async (_p: number, host: string) => byHost?.[host] ?? REFUSED),
    readLockMeta: () => null,
    peekInstanceId: () => null,
    isProcessAlive: () => true,
    now: () => NOW,
    ...rest,
  } as ClassifyDeps;
}

afterEach(() => vi.restoreAllMocks());

describe("classifyDashboardPort", () => {
  // E7 — start's ownership predicate and stop's are one function.
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("E7: instanceId match=%s × lock-meta match=%s agrees with stop's collectOwnedPids", async (idMatch, lockMatch) => {
    const HOLDER = 77;
    const health = { pid: HOLDER, instanceId: idMatch ? "ID" : "OTHER" };
    const m = lockMatch ? meta({ pid: HOLDER }) : meta({ pid: 1111 });

    const verdict = await classifyDashboardPort(cfg, deps({
      byHost: { "127.0.0.1": { running: true, ...health } },
      readLockMeta: () => m,
      peekInstanceId: () => "ID",
    }));
    const stopOwned = await collectOwnedPids(cfg, {
      readLockMeta: () => m,
      peekInstanceId: () => "ID",
      fetchHealth: async () => ({ ok: true, json: async () => health }),
    });
    expect(verdict.kind === "owned").toBe(stopOwned.has(HOLDER));
    expect(verdict.kind).toBe(idMatch || lockMatch ? "owned" : "unowned-dashboard");
  });

  it("E9: an owned answer on ::1 only is still owned; both loopbacks are probed", async () => {
    const d = deps({ byHost: { "::1": { running: true, pid: 9, instanceId: "ID" } }, peekInstanceId: () => "ID" });
    const v = await classifyDashboardPort(cfg, d);
    expect(v).toMatchObject({ kind: "owned", pid: 9 });
    const hosts = (d.probe as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(hosts).toEqual(expect.arrayContaining(["127.0.0.1", "::1"]));
  });

  it("an owned answer beats an unowned one on another address", async () => {
    const v = await classifyDashboardPort(cfg, deps({
      byHost: {
        "127.0.0.1": { running: true, pid: 1, instanceId: "FOREIGN" },
        "::1": { running: true, pid: 2, instanceId: "ID" },
      },
      peekInstanceId: () => "ID",
    }));
    expect(v).toMatchObject({ kind: "owned", pid: 2 });
  });

  it("a dashboard with no proof of ownership is `unowned-dashboard`, naming its pid", async () => {
    const v = await classifyDashboardPort(cfg, deps({ byHost: { "127.0.0.1": { running: true, pid: 31 } } }));
    expect(v).toEqual({ kind: "unowned-dashboard", pid: 31 });
  });

  it("a non-dashboard HTTP service is `conflict`", async () => {
    const v = await classifyDashboardPort(cfg, deps({ byHost: { "127.0.0.1": { running: false, portConflict: true } } }));
    expect(v.kind).toBe("conflict");
  });

  it("silent port → `unresponsive`, pid from live lock metadata only", async () => {
    const v = await classifyDashboardPort(cfg, deps({
      byHost: { "127.0.0.1": SILENT, "::1": SILENT },
      readLockMeta: () => meta({ pid: 555 }),
    }));
    expect(v).toEqual({ kind: "unresponsive", pid: 555 });
    const noMeta = await classifyDashboardPort(cfg, deps({ byHost: { "127.0.0.1": SILENT } }));
    expect(noMeta).toEqual({ kind: "unresponsive", pid: undefined });
  });

  it("one silent address among refusals still means `unresponsive`", async () => {
    const v = await classifyDashboardPort(cfg, deps({ byHost: { "::1": SILENT } }));
    expect(v.kind).toBe("unresponsive");
  });

  // E5 / E6 — the 30 s start grace.
  it("E5: refused + live lock holder started 29 s ago → starting", async () => {
    const v = await classifyDashboardPort(cfg, deps({ readLockMeta: () => meta({ startedAt: NOW - 29_000 }) }));
    expect(v).toEqual({ kind: "starting", pid: 4242 });
  });

  it("E6: the same holder started 31 s ago → free", async () => {
    const v = await classifyDashboardPort(cfg, deps({ readLockMeta: () => meta({ startedAt: NOW - 31_000 }) }));
    expect(v.kind).toBe("free");
  });

  it("a dead lock holder, or a record for another port, is never `starting`", async () => {
    expect((await classifyDashboardPort(cfg, deps({
      readLockMeta: () => meta({ startedAt: NOW - 1000 }), isProcessAlive: () => false,
    }))).kind).toBe("free");
    expect((await classifyDashboardPort(cfg, deps({
      readLockMeta: () => meta({ startedAt: NOW - 1000, httpPort: 1 }),
    }))).kind).toBe("free");
  });

  it("an unreadable lock record or failing instance-id read degrades to `free` / unowned, never throws", async () => {
    const boom = () => { throw new Error("EACCES"); };
    expect((await classifyDashboardPort(cfg, deps({ readLockMeta: boom }))).kind).toBe("free");
    const v = await classifyDashboardPort(cfg, deps({ byHost: { "127.0.0.1": { running: true, pid: 5 } }, peekInstanceId: boom }));
    expect(v.kind).toBe("unowned-dashboard");
  });

  it("a probe that throws counts as a silent address", async () => {
    const v = await classifyDashboardPort(cfg, deps({ probe: vi.fn(async () => { throw new Error("x"); }) as never }));
    expect(v.kind).toBe("unresponsive");
  });

  it("probes a specific non-loopback bind host too, and nothing extra for wildcard/loopback binds", () => {
    expect(classifyHosts("10.0.0.5")).toEqual(["127.0.0.1", "::1", "10.0.0.5"]);
    for (const h of ["", "0.0.0.0", "::", "localhost", "127.0.0.1", null, undefined]) {
      expect(classifyHosts(h)).toEqual(["127.0.0.1", "::1"]);
    }
  });

  it("is read-only: only the probe and the injected readers are touched", async () => {
    const d = deps();
    await classifyDashboardPort(cfg, d);
    expect(Object.keys(d).sort()).toEqual(["isProcessAlive", "now", "peekInstanceId", "probe", "readLockMeta"]);
  });
});

describe("classifyDashboardPort — probe budget (real isDashboardRunning, stubbed fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  const refusal = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

  // E10
  it("E10: a free port costs one attempt per address and zero sleeps", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(refusal());
    const sleep = vi.fn(async () => {});
    const v = await classifyDashboardPort(cfg, { readLockMeta: () => null, peekInstanceId: () => null, sleep });
    expect(v.kind).toBe("free");
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.sort()).toEqual([`http://127.0.0.1:${P}/api/health`, `http://[::1]:${P}/api/health`].sort());
    expect(sleep).not.toHaveBeenCalled();
  });

  // P1
  it("P1: a silent port costs 3 attempts + 2 sleeps per address, probed in parallel, ≤ 7 s worst case", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      throw Object.assign(new Error("t"), { name: "AbortError" });
    }) as never;
    const sleeps: number[] = [];
    const v = await classifyDashboardPort({ ...cfg, host: "10.0.0.5" }, {
      readLockMeta: () => null,
      peekInstanceId: () => null,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(v.kind).toBe("unresponsive");
    expect(calls).toHaveLength(9); // 3 addresses × 3 attempts
    expect(sleeps).toEqual([500, 500, 500, 500, 500, 500]); // 2 per address
    // The first attempt on every address starts before any retry → parallel.
    expect(new Set(calls.slice(0, 3)).size).toBe(3);
    const { timeoutMs, retries, retryDelayMs } = CLASSIFY_PROBE_OPTS;
    expect((retries + 1) * timeoutMs + retries * retryDelayMs).toBeLessThanOrEqual(7000);
  });
});
