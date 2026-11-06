/**
 * Lock staleness + acquisition scenarios E5, E6, E7, E8, E9, X6, X7.
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireAutoStartLock,
  autoStartLockPath,
  isLockStale,
  readLock,
  recordChildPid,
  releaseAutoStartLock,
  type AutoStartLockRecord,
  type LockProbes,
} from "../autostart-lock.js";
import { autoStartServer, type AutoStartDeps } from "../server-auto-start.js";

const BUDGET = 30_000;
const NOW = 1_700_000_000_000;

function probes(over: Partial<LockProbes> = {}): LockProbes {
  return {
    now: () => NOW,
    isAlive: () => false,
    processStartedAt: () => null,
    ...over,
  };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "autostart-lock-")); });
afterEach(() => { try { chmodSync(dir, 0o755); } catch {} rmSync(dir, { recursive: true, force: true }); });

describe("isLockStale", () => {
  it("E5: holder dead but recorded child alive → NOT stale", () => {
    const lock: AutoStartLockRecord = {
      sessionPid: 111, childPid: 222, startedAt: NOW, cliPath: "/x/cli.ts",
    };
    const stale = isLockStale(lock, probes({ isAlive: (pid) => pid === 222 }), BUDGET);
    expect(stale).toBe(false);
  });

  it("E6: holder pid alive but its process started AFTER the lock → pid reuse → stale", () => {
    const lock: AutoStartLockRecord = { sessionPid: 111, startedAt: NOW, cliPath: "/x/cli.ts" };
    const stale = isLockStale(
      lock,
      probes({ isAlive: () => true, processStartedAt: () => NOW + 60_000 }),
      BUDGET,
    );
    expect(stale).toBe(true);
  });

  it("E7: age = budget − 1s with a live holder → NOT stale", () => {
    const lock: AutoStartLockRecord = {
      sessionPid: 111, startedAt: NOW - (BUDGET - 1_000), cliPath: "/x/cli.ts",
    };
    const stale = isLockStale(
      lock,
      probes({ isAlive: () => true, processStartedAt: () => NOW - BUDGET }),
      BUDGET,
    );
    expect(stale).toBe(false);
  });

  it("E8: age = budget + 1s → stale", () => {
    const lock: AutoStartLockRecord = {
      sessionPid: 111, startedAt: NOW - (BUDGET + 1_000), cliPath: "/x/cli.ts",
    };
    const stale = isLockStale(
      lock,
      probes({ isAlive: () => true, processStartedAt: () => NOW - BUDGET * 2 }),
      BUDGET,
    );
    expect(stale).toBe(true);
  });

  it("X7: corrupt lockfile parses to null → treated as stale, no throw", () => {
    writeFileSync(autoStartLockPath(8000, dir), "{not valid json");
    expect(() => isLockStale(null, probes(), BUDGET)).not.toThrow();
    expect(isLockStale(null, probes(), BUDGET)).toBe(true);

    // …and acquisition over that corrupt file succeeds rather than throwing.
    const res = acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir }, probes(), BUDGET);
    expect(res.acquired).toBe(true);
  });
});

describe("acquireAutoStartLock", () => {
  it("second acquisition against a live holder is refused", () => {
    const alive = probes({ isAlive: () => true, processStartedAt: () => NOW - 1_000 });
    const first = acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 42 }, alive, BUDGET);
    const second = acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 43 }, alive, BUDGET);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.holder?.sessionPid).toBe(42);
  });

  it("E9: release removes the lockfile so the next acquisition does not wait for staleness", () => {
    const alive = probes({ isAlive: () => true, processStartedAt: () => NOW - 1_000 });
    acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 42 }, alive, BUDGET);
    releaseAutoStartLock(8000, dir, 42);

    expect(existsSync(autoStartLockPath(8000, dir))).toBe(false);
    expect(acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 43 }, alive, BUDGET).acquired).toBe(true);
  });

  it("X6: unwritable lock directory degrades instead of throwing", () => {
    // Point at a nested directory that does not exist and is never created.
    const res = acquireAutoStartLock(
      { port: 8000, cliPath: "/x/cli.ts", dir: join(dir, "nope", "deeper") },
      probes(),
      BUDGET,
    );
    expect(res.acquired).toBe(true);
    expect(res.degraded).toBe(true);
  });

  it("a stale lock is broken and re-acquired", () => {
    const dead = probes({ isAlive: () => false });
    acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 42 }, dead, BUDGET);
    const second = acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 43 }, dead, BUDGET);
    expect(second.acquired).toBe(true);
  });
});

/**
 * CodeRabbit finding: both lock mutations acted on the PORT, not on ownership.
 * A holder that overran the budget could rewrite or delete a lock another
 * session had already broken and re-acquired — re-opening the double-spawn
 * window the lock exists to close.
 * See change: fix-worktree-server-autostart-leak.
 */
describe("lock mutations are ownership-checked", () => {
  it("release does NOT delete a lock owned by someone else", () => {
    const alive = probes({ isAlive: () => true, processStartedAt: () => NOW - 1_000 });
    acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 99 }, alive, BUDGET);

    // The overrun holder (pid 42) tries to release the new holder's lock.
    releaseAutoStartLock(8000, dir, 42);

    expect(existsSync(autoStartLockPath(8000, dir))).toBe(true);
    expect(readLock(autoStartLockPath(8000, dir))?.sessionPid).toBe(99);
  });

  it("release removes a lock we still own", () => {
    acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 42 }, probes(), BUDGET);
    releaseAutoStartLock(8000, dir, 42);
    expect(existsSync(autoStartLockPath(8000, dir))).toBe(false);
  });

  it("recordChildPid does NOT write into someone else's lock", () => {
    acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 99 }, probes(), BUDGET);

    recordChildPid(8000, 4242, dir, 42);

    expect(readLock(autoStartLockPath(8000, dir))?.childPid).toBeUndefined();
  });

  it("recordChildPid writes into our own lock", () => {
    acquireAutoStartLock({ port: 8000, cliPath: "/x/cli.ts", dir, sessionPid: 42 }, probes(), BUDGET);
    recordChildPid(8000, 4242, dir, 42);
    expect(readLock(autoStartLockPath(8000, dir))?.childPid).toBe(4242);
  });
});

// raise-node-floor-to-26 (test-plan #X4): server-spawn runtime resolution runs
// inside the single-flight lock — two concurrent sessions resolve once.
describe("server Node resolution under the single-flight lock (#X4)", () => {
  beforeEach(() => { process.env["PI_DASHBOARD_NO_MDNS"] = "1"; });
  afterEach(() => { delete process.env["PI_DASHBOARD_NO_MDNS"]; });

  it("resolves once and logs one selection line across two concurrent sessions", async () => {
    const resolveServerNode = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { resolved: true, nodeBinary: "/n26/bin/node", version: "v26.0.0", step: "path", range: ">=26.0.0 <27", trail: [] };
    });
    let up = false;
    const launchServer = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      up = true;
      return { success: true, message: "ok" };
    });
    const log = vi.fn();
    const deps = (): AutoStartDeps => ({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockImplementation(async () => ({ running: up })),
      launchServer,
      notify: vi.fn(),
      resolveCliPath: () => "/opt/pi-dashboard/packages/server/src/cli.ts",
      lockDir: dir,
      log,
      readinessBudgetMs: BUDGET,
      lossPollIntervalMs: 5,
      resolveServerNode,
    });
    const cfg = { piPort: 9999, port: 8000, autoStart: true };

    await Promise.all([autoStartServer(cfg, deps()), autoStartServer(cfg, deps())]);

    expect(resolveServerNode).toHaveBeenCalledTimes(1);
    expect(launchServer).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.filter((c) => String(c[0]).startsWith("server runtime:"))).toHaveLength(1);
  });
});
