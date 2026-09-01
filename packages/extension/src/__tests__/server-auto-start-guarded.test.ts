/**
 * `autoStartServer` refusal / single-flight / spinner / logging scenarios:
 * E4, E13, E15-E17, E19, F1, F2, X2, X3, X4, X5, P2.
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoStartLockPath } from "../autostart-lock.js";
import { autoStartServer, type AutoStartDeps, type DiscoveredServer } from "../server-auto-start.js";

const WORKTREE_CLI = "/repo/.worktrees/os-x/packages/server/src/cli.ts";
const HOST_CLI = "/opt/pi-dashboard/packages/server/src/cli.ts";
const BUDGET = 30_000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "autostart-flow-"));
  process.env["PI_DASHBOARD_NO_MDNS"] = "1";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env["PI_DASHBOARD_NO_MDNS"];
});

function makeDeps(over: Partial<AutoStartDeps> = {}): AutoStartDeps {
  return {
    discoverDashboard: vi.fn().mockResolvedValue([]),
    isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
    launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok", childPid: 4242 }),
    notify: vi.fn(),
    resolveCliPath: () => HOST_CLI,
    lockDir: dir,
    log: vi.fn(),
    readinessBudgetMs: BUDGET,
    lossPollIntervalMs: 5,
    ...over,
  };
}

const cfg = { piPort: 9999, port: 8000, autoStart: true };

describe("worktree refusal", () => {
  it("E13: refuses, returns {} without throwing, never invokes launchServer", async () => {
    const deps = makeDeps({ resolveCliPath: () => WORKTREE_CLI });
    const result = await autoStartServer(cfg, deps);

    expect(result).toEqual({});
    expect(deps.launchServer).not.toHaveBeenCalled();
  });

  it("E15: gateway-port-only evasion is still refused", async () => {
    const deps = makeDeps({ resolveCliPath: () => WORKTREE_CLI });
    await autoStartServer({ ...cfg, port: 8001 }, deps);
    expect(deps.launchServer).not.toHaveBeenCalled();
  });

  it("E16: a fully isolated worktree still spawns, with its own ports", async () => {
    const deps = makeDeps({ resolveCliPath: () => WORKTREE_CLI });
    const isolated = { piPort: 19042, port: 18042, autoStart: true };
    await autoStartServer(isolated, deps);
    expect(deps.launchServer).toHaveBeenCalledTimes(1);
    expect(deps.launchServer).toHaveBeenCalledWith(isolated);
  });

  it("E17: a host install serving a worktree cwd still spawns", async () => {
    const deps = makeDeps({ resolveCliPath: () => HOST_CLI });
    await autoStartServer(cfg, deps);
    expect(deps.launchServer).toHaveBeenCalledTimes(1);
  });

  it("E19: refusal precedes lock acquisition — no lockfile is created", async () => {
    const deps = makeDeps({ resolveCliPath: () => WORKTREE_CLI });
    await autoStartServer(cfg, deps);
    expect(existsSync(autoStartLockPath(cfg.port, dir))).toBe(false);

    // …and a concurrent host session acquires without contention.
    const host = makeDeps({ resolveCliPath: () => HOST_CLI });
    await autoStartServer(cfg, host);
    expect(host.launchServer).toHaveBeenCalledTimes(1);
  });

  it("X1/X2: the refusal is durably logged even when `notify` throws (headless)", async () => {
    const log = vi.fn();
    const deps = makeDeps({
      resolveCliPath: () => WORKTREE_CLI,
      log,
      notify: vi.fn(() => { throw new Error("no UI"); }),
    });

    const result = await autoStartServer(cfg, deps);

    expect(result).toEqual({});
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0] as string;
    expect(line).toContain(WORKTREE_CLI);
    expect(line).toContain("8000");
    expect(line).toContain("9999");
  });

  it("F1: refusal never starts a spinner it does not stop", async () => {
    const onLaunchStart = vi.fn();
    const onLaunchEnd = vi.fn();
    const deps = makeDeps({ resolveCliPath: () => WORKTREE_CLI, onLaunchStart, onLaunchEnd });

    await autoStartServer(cfg, deps);

    expect(onLaunchStart).not.toHaveBeenCalled();
    expect(onLaunchEnd).not.toHaveBeenCalled();
  });
});

describe("single-flight lock", () => {
  it("E4: two concurrent calls in the same tick spawn exactly once", async () => {
    const launchServer = vi.fn().mockImplementation(
      () => new Promise(r => setTimeout(() => r({ success: true, message: "ok" }), 5)),
    );
    const a = makeDeps({ launchServer });
    const b = makeDeps({ launchServer });

    await Promise.all([autoStartServer(cfg, a), autoStartServer(cfg, b)]);

    expect(launchServer).toHaveBeenCalledTimes(1);
  });

  it("X3: lock loss is durably logged, naming the recorded holder", async () => {
    const holderLaunch = vi.fn().mockImplementation(
      () => new Promise(r => setTimeout(() => r({ success: true, message: "ok" }), 20)),
    );
    const holder = makeDeps({ launchServer: holderLaunch });
    const loserLog = vi.fn();
    const loser = makeDeps({ log: loserLog });

    const holderRun = autoStartServer(cfg, holder);
    await autoStartServer(cfg, loser);
    await holderRun;

    expect(loserLog).toHaveBeenCalledTimes(1);
    expect(loserLog.mock.calls[0]![0]).toContain(String(process.pid));
  });

  it("X4: the loser waits for the holder, then attaches to its server", async () => {
    const holder = makeDeps({
      launchServer: vi.fn().mockImplementation(
        () => new Promise(r => setTimeout(() => r({ success: true, message: "ok" }), 20)),
      ),
    });
    const loser = makeDeps({
      // first probe: nothing yet; then the holder's server comes up.
      isDashboardRunning: vi.fn()
        .mockResolvedValueOnce({ running: false })
        .mockResolvedValue({ running: true }),
    });

    const holderRun = autoStartServer(cfg, holder);
    const result = await autoStartServer(cfg, loser);
    await holderRun;

    expect(loser.launchServer).not.toHaveBeenCalled();
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
  });

  it("X4: the loser POLLS — it must not burn the whole budget when the holder is quick", async () => {
    const holder = makeDeps({
      launchServer: vi.fn().mockImplementation(
        () => new Promise(r => setTimeout(() => r({ success: true, message: "ok" }), 20)),
      ),
    });
    // Real timers, real (short) poll interval, and a REAL budget-sized clock:
    // a blind `sleep(budget)` would make this take BUDGET ms.
    const loser = makeDeps({
      lossPollIntervalMs: 5,
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
    });

    const holderRun = autoStartServer(cfg, holder);
    const t0 = Date.now();
    await autoStartServer(cfg, loser);
    const elapsed = Date.now() - t0;
    await holderRun;

    // Bounded by the holder finishing (~20ms), not by the 30s budget.
    expect(elapsed).toBeLessThan(BUDGET / 10);
    expect(loser.launchServer).not.toHaveBeenCalled();
  });

  it("X5: the loser reports unavailable when the holder's spawn fails", async () => {
    const holder = makeDeps({
      launchServer: vi.fn().mockImplementation(
        () => new Promise(r => setTimeout(() => r({ success: false, message: "boom" }), 20)),
      ),
    });
    const loser = makeDeps();

    const holderRun = autoStartServer(cfg, holder);
    const result = await autoStartServer(cfg, loser);
    await holderRun;

    expect(result).toEqual({});
    expect(loser.launchServer).not.toHaveBeenCalled();
  });

  it("F2: losing the lock never starts a spinner it does not stop", async () => {
    const holder = makeDeps({
      launchServer: vi.fn().mockImplementation(
        () => new Promise(r => setTimeout(() => r({ success: true, message: "ok" }), 20)),
      ),
    });
    const onLaunchStart = vi.fn();
    const onLaunchEnd = vi.fn();
    const loser = makeDeps({ onLaunchStart, onLaunchEnd });

    const holderRun = autoStartServer(cfg, holder);
    await autoStartServer(cfg, loser);
    await holderRun;

    expect(onLaunchStart).not.toHaveBeenCalled();
    expect(onLaunchEnd).not.toHaveBeenCalled();
  });

  it("E9: a failed spawn releases the lock, so the next call acquires immediately", async () => {
    const first = makeDeps({
      launchServer: vi.fn().mockResolvedValue({ success: false, message: "readiness timeout" }),
    });
    await autoStartServer(cfg, first);
    expect(existsSync(autoStartLockPath(cfg.port, dir))).toBe(false);

    const second = makeDeps();
    await autoStartServer(cfg, second);
    expect(second.launchServer).toHaveBeenCalledTimes(1);
  });
});

// fix-autostart-discovery-precedence (D2, folded test-plan E4/E5): a
// discovered candidate is admitted only after GET /api/health succeeds at
// its advertised host+port; an unverifiable candidate never suppresses the
// launch step, and its rejection is durably logged with endpoint + reason.
describe("candidate health verification gates admission (test-plan E4/E5)", () => {
  const scriptedProbe = (script: Record<string, { running: boolean }>) =>
    vi.fn(async (port: number, host = "localhost") => script[`${host}:${port}`] ?? { running: false });

  it("E4: an unhealthy candidate is rejected and launch proceeds (test-plan E4)", async () => {
    delete process.env.PI_DASHBOARD_NO_MDNS; // discovery must run for this scenario
    const candidate: DiscoveredServer = {
      host: "localhost", port: 8588, piPort: 19697, isLocal: true, source: "mdns",
    };
    const log = vi.fn();
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([candidate]),
      isDashboardRunning: scriptedProbe({
        "localhost:8000": { running: false },
        "localhost:8588": { running: false },
      }),
      log,
    });

    const result = await autoStartServer(cfg, deps);

    expect(deps.launchServer).toHaveBeenCalledTimes(1);
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    const lines = log.mock.calls.map(c => c[0] as string).join("\n");
    expect(lines).toMatch(/rejected/);
    expect(lines).toContain("8588");
  });

  it("E5: a candidate whose health probe cannot answer is rejected and logged with the reason (test-plan E5)", async () => {
    delete process.env.PI_DASHBOARD_NO_MDNS;
    const candidate: DiscoveredServer = {
      host: "slow.local", port: 8588, piPort: 19697, isLocal: true, source: "mdns",
    };
    const log = vi.fn();
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([candidate]),
      isDashboardRunning: scriptedProbe({
        "localhost:8000": { running: false },
        // candidate probe never answers → the shared probe reports it silent
        "slow.local:8588": { running: false },
      }),
      log,
    });

    const result = await autoStartServer(cfg, deps);

    expect(deps.launchServer).toHaveBeenCalledTimes(1);
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    const lines = log.mock.calls.map(c => c[0] as string).join("\n");
    expect(lines).toMatch(/rejected/);
    expect(lines).toContain("slow.local:8588");
    expect(lines).toMatch(/answer/); // the reason
  });
});

describe("P2: lock acquisition is not a startup tax", () => {
  it("100 sequential calls with a reachable dashboard never touch the lock", async () => {
    const deps = makeDeps({
      isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
    });

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await autoStartServer(cfg, deps);
      samples.push(performance.now() - t0);
    }

    // The structural half of the requirement, and the one that actually
    // guarantees the latency: the reachable path short-circuits BEFORE the
    // lock, so no lockfile is ever created.
    expect(existsSync(autoStartLockPath(cfg.port, dir))).toBe(false);

    // The timing half, expressed RELATIVE to this machine. An absolute 5ms p95
    // is a property of the runner, not of the code, and a loaded CI box fails
    // it while the code is correct. Compare against the cost of the awaits the
    // call cannot avoid.
    const baseline: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await deps.isDashboardRunning(cfg.port);
      baseline.push(performance.now() - t0);
    }
    const p95 = (xs: number[]) => xs.slice().sort((a, b) => a - b)[94]!;
    expect(p95(samples)).toBeLessThan(Math.max(5, p95(baseline) * 20));
  });
});
