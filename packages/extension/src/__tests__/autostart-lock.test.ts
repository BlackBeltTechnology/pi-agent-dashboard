/**
 * Lock staleness + acquisition scenarios E5, E6, E7, E8, E9, X6, X7.
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireAutoStartLock,
  autoStartLockPath,
  isLockStale,
  releaseAutoStartLock,
  type AutoStartLockRecord,
  type LockProbes,
} from "../autostart-lock.js";

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
    releaseAutoStartLock(8000, dir);

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
