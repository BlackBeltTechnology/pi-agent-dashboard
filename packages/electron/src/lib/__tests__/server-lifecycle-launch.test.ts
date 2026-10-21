/**
 * Unit tests for `requestServerLaunch` idempotency contract.
 * See change: electron-server-launch-controls (R3, task 1.8).
 *
 * NOTE: Full end-to-end coverage of the spawn path is out of scope here —
 * `ensureServer()` boots the server through the native TS loader and is exercised by QA harness.
 * These tests cover the wrapper's value-shape contract: failure-as-value,
 * concurrency-share, and the always-running short-circuit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showMessageBox: vi.fn() } }));

// Stub the heavy imports BEFORE importing the SUT.
vi.mock("../health-check.js", () => ({
  isDashboardRunning: vi.fn(),
}));

// We can't easily mock ensureServer() inside the same module — instead the
// tests below either short-circuit on the already-running branch (no spawn)
// or expect the real ensureServer to fail (no tsx in vitest env) and assert
// the failure-as-value behaviour.

import { isDashboardRunning } from "../health-check.js";
import { type ForceRestartDeps, isManagedServerRunning, requestServerLaunch, setLocalServerSpawner } from "../server-lifecycle.js";
import { stopZombieServer } from "../zombie-adoption-dialog.js";

const mockHealth = isDashboardRunning as unknown as ReturnType<typeof vi.fn>;

describe("requestServerLaunch", () => {
  beforeEach(() => {
    mockHealth.mockReset();
  });

  it("returns already-running when health check reports running", async () => {
    mockHealth.mockResolvedValue({ running: true, pid: 1234 });
    const outcome = await requestServerLaunch();
    expect(outcome.kind).toBe("already-running");
    if (outcome.kind === "already-running") {
      expect(outcome.url).toMatch(/^http:\/\/localhost:\d+$/);
    }
  });

  it("returns failed (never throws) when spawn path errors out", async () => {
    // Server not running → ensureServer() will be called and likely fail in
    // the test sandbox (no tsx, no managed install). We assert the result is
    // a value, not a thrown exception.
    mockHealth.mockResolvedValue({ running: false });
    const outcome = await requestServerLaunch();
    expect(outcome.kind === "failed" || outcome.kind === "started").toBe(true);
    if (outcome.kind === "failed") {
      expect(typeof outcome.reason).toBe("string");
      expect(typeof outcome.logTail).toBe("string");
    }
  });

  it("concurrent calls share one launch attempt", async () => {
    mockHealth.mockResolvedValue({ running: true });
    const [a, b] = await Promise.all([requestServerLaunch(), requestServerLaunch()]);
    expect(a).toEqual(b);
    // Only one health probe should fire for the shared inflight promise.
    // (The second caller awaits the first's promise without re-probing.)
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });
});

describe("isManagedServerRunning", () => {
  beforeEach(() => mockHealth.mockReset());
  it("returns true when health check reports running", async () => {
    mockHealth.mockResolvedValue({ running: true });
    expect(await isManagedServerRunning()).toBe(true);
  });
  it("returns false when health check reports not-running", async () => {
    mockHealth.mockResolvedValue({ running: false });
    expect(await isManagedServerRunning()).toBe(false);
  });
});

// ── Force restart: PID-confirmed stop (X1–X7) ──────────────────────────────
// See change: electron-attach-version-skew (D4, D4b).

describe("requestServerLaunch({ force: true }) — PID-confirmed restart", () => {
  const OLD = 4242;

  /** Virtual-time rig: `sleep` advances the clock; liveness/port are functions of it. */
  function rig(o: {
    pidDiesAt?: number; // ms; undefined = never (until signalled)
    portClosesAt?: number;
    diesAfterTermMs?: number;
    diesAfterKillMs?: number;
    eperm?: boolean;
    foreignAfterGone?: boolean;
    shutdownRejects?: boolean;
  }) {
    let now = 0;
    let termAt: number | null = null;
    let killAt: number | null = null;
    const signals: Array<{ sig: string; at: number }> = [];
    const alive = () => {
      if (o.eperm) return true;
      if (o.pidDiesAt !== undefined && now >= o.pidDiesAt) return false;
      if (termAt !== null && o.diesAfterTermMs !== undefined && now >= termAt + o.diesAfterTermMs) return false;
      if (killAt !== null && o.diesAfterKillMs !== undefined && now >= killAt + o.diesAfterKillMs) return false;
      return true;
    };
    const sleep = async (ms: number) => { now += ms; };
    const kill = (_p: number, sig: NodeJS.Signals) => {
      signals.push({ sig, at: now });
      if (sig === "SIGTERM") termAt = now; else killAt = now;
    };
    const spawner = vi.fn(async () => ({ kind: "spawned" as const, pid: 9999 }));
    setLocalServerSpawner(spawner as never);
    mockHealth.mockImplementation(async () => {
      const portUp = o.portClosesAt !== undefined ? now < o.portClosesAt : alive();
      const respawned = spawner.mock.calls.length > 0;
      return { running: portUp || (o.foreignAfterGone === true && !respawned) };
    });
    const postShutdown = vi.fn(async () => { if (o.shutdownRejects) throw new Error("ECONNREFUSED"); });
    const deps: ForceRestartDeps = {
      readServerPid: async () => OLD,
      postShutdown,
      isAlive: alive,
      stopProcess: (pid) => stopZombieServer(pid, { kill, isAlive: alive, sleep }),
      sleep,
    };
    return { deps, spawner, signals, postShutdown, now: () => now };
  }

  beforeEach(() => mockHealth.mockReset());

  it("X1: graceful exit → no signal, one spawn after ESRCH, started", async () => {
    const r = rig({ pidDiesAt: 1000 });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("started");
    expect(r.signals).toEqual([]);
    expect(r.spawner).toHaveBeenCalledTimes(1);
  });

  it("X2: waits for the PID, not the port", async () => {
    const r = rig({ portClosesAt: 200, pidDiesAt: 3000 });
    let nowAtSpawn = -1;
    r.spawner.mockImplementation(async () => { nowAtSpawn = r.now(); return { kind: "spawned" as const, pid: 1 }; });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("started");
    expect(nowAtSpawn).toBeGreaterThanOrEqual(3000);
    expect(r.signals).toEqual([]);
  });

  it("X3: SIGTERM at the 5 s boundary, no SIGKILL, spawn after ESRCH", async () => {
    const r = rig({ diesAfterTermMs: 1000 });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("started");
    expect(r.signals.map((s) => s.sig)).toEqual(["SIGTERM"]);
    expect(r.signals[0].at).toBeGreaterThanOrEqual(5000);
    expect(r.spawner).toHaveBeenCalledTimes(1);
  });

  it("X4: PID outliving SIGKILL + 2 s → failed, spawner never called", async () => {
    const r = rig({ diesAfterTermMs: 1e9, diesAfterKillMs: 2200 });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("failed");
    expect(r.spawner).not.toHaveBeenCalled();
  });

  it("X5: EPERM counts as alive → escalation then failed", async () => {
    const r = rig({ eperm: true });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("failed");
    expect(r.signals.map((s) => s.sig)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(r.spawner).not.toHaveBeenCalled();
  });

  it("X6: a surviving foreign server is failed, not started", async () => {
    const r = rig({ pidDiesAt: 500, foreignAfterGone: true });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") expect(out.reason).toMatch(/still answering/);
    expect(r.spawner).not.toHaveBeenCalled();
  });

  it("X7: shutdown POST failure still waits on the PID, then spawns", async () => {
    const r = rig({ pidDiesAt: 500, shutdownRejects: true });
    const out = await requestServerLaunch({ force: true, deps: r.deps });
    expect(out.kind).toBe("started");
    expect(r.postShutdown).toHaveBeenCalled();
    expect(r.spawner).toHaveBeenCalledTimes(1);
  });
});
