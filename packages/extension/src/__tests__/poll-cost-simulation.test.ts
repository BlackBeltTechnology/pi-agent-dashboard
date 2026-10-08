/**
 * Timed simulations of the poll cost with the REAL schedulers on a fake clock.
 * test-plan ids: P1 (idle spawns/min ≥ 5× lower than the old fixed-interval
 * model), P2 (active session: ≤ 6 slow probes/min, zero sync git spawns).
 * See change: optimize-polling-hot-paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { BridgeContext } from "../bridge-context.js";
import { createGitTracker } from "../git-tracker.js";
import { createProcessScanScheduler } from "../process-scan-scheduler.js";
import { GitFactsCache, type HeadBranchReader } from "../vcs-info.js";

const CLEAN: GitStatus = { dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

function tracker() {
  const bc = { sessionId: "s", connection: { send: vi.fn() }, prStatus: undefined } as unknown as BridgeContext;
  const evaluate = vi.fn(() => ({ roots: null, gitDir: "/r/.git", dotGitStamp: "s" }));
  const statusProbe = vi.fn(async () => ({ ok: true as const, value: CLEAN }));
  const reader: HeadBranchReader = { read: () => "main", reset: () => {} };
  const t = createGitTracker({
    getBc: () => bc,
    applyBc: () => {},
    isActive: () => true,
    facts: new GitFactsCache({ evaluate, evaluateAsync: async () => ({ roots: null, gitDir: "/r/.git", dotGitStamp: "s" }), stamp: () => "s" }),
    statusProbe: statusProbe as any,
    headReader: () => reader,
    watch: () => ({ close: () => {}, on: () => ({}) as any }) as any,
  });
  return { t, bc, evaluate, statusProbe };
}

describe("poll cost simulations", () => {
  it("P1: an idle session spawns ≥ 5× less than the old fixed-interval model", async () => {
    const MIN = 10;
    // Old model (design inventory): scan every 5 s costs (3 + k) sync `ps`
    // with k = 3 children; the 30 s tick costs ~6 sync git spawns (2 of them `git status`).
    const oldPerMin = 12 * (3 + 3) + 2 * 6;

    let scanSpawns = 0;
    const sched = createProcessScanScheduler({
      platform: "linux",
      scan: async () => {
        scanSpawns += 1;
        return { changed: false };
      },
    });
    sched.start();
    const { t, bc, statusProbe } = tracker();
    t.evaluateFirst(bc, "/r");
    for (let i = 0; i < MIN * 2; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      t.tick(bc, "/r");
    }
    await vi.advanceTimersByTimeAsync(11_000);
    const newPerMin = (scanSpawns + statusProbe.mock.calls.length) / MIN;
    expect(newPerMin).toBeLessThanOrEqual(oldPerMin / 5);
    sched.dispose();
    t.dispose();
  });

  it("P2: an active session (tool end every 2 s, 5 min) probes ≤ 6 times/min with no sync facts probe", async () => {
    const { t, bc, evaluate, statusProbe } = tracker();
    t.evaluateFirst(bc, "/r");
    await vi.advanceTimersByTimeAsync(2_000);
    statusProbe.mockClear();
    for (let s = 0; s < 300; s += 2) {
      t.onToolEnd("edit");
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(statusProbe.mock.calls.length / 5).toBeLessThanOrEqual(6);
    expect(evaluate).toHaveBeenCalledTimes(1);
    t.dispose();
  });
});
