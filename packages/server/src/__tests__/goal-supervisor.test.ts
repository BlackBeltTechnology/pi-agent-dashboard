/**
 * Tests for the goal session supervisor (goal POLICY on the host mechanism).
 *
 * Covers `openspec/changes/add-goal-session-supervisor/specs/goal-supervisor/spec.md`:
 *   - death classification (ignore non-current / terminal)
 *   - autoRespawn off → paused "session ended"
 *   - progress-gated resume vs poison fresh
 *   - backoff growth + reset on progress
 *   - crash-loop breaker → failed "crash loop"
 *   - abort ordering (terminal-first, generation-guarded, kill-death no-op)
 *   - boot reconcile
 *   - headless-unavailable disables auto-respawn
 *
 * Uses the REAL goal store (tmp dir) for fidelity + injected spawn/kill fakes.
 * A manual timer queue makes backoff deterministic.
 *
 * See change: add-goal-session-supervisor.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoalStore, type GoalStore } from "../goal-store.js";
import {
  BREAKER_COUNT,
  BREAKER_WINDOW_MS,
  createGoalSupervisor,
  type GoalDriverSpawnRequest,
  type GoalSupervisor,
  POISON_K,
} from "../goal-supervisor.js";

interface FakeTimer {
  fn: () => void;
  ms: number;
  fired: boolean;
}

describe("goal-supervisor", () => {
  let dataDir: string;
  let store: GoalStore;
  let clock: number;
  let timers: FakeTimer[];
  let spawns: GoalDriverSpawnRequest[];
  let killedTokens: string[];
  let killedSessions: string[];
  let liveSessions: Set<string>;
  let sessionFiles: Map<string, string>;
  let spawnResult: { success: boolean; message?: string };
  let headless: boolean;
  let sup: GoalSupervisor;
  const cwd = "/repo/x";

  function makeSup(): GoalSupervisor {
    return createGoalSupervisor({
      store,
      now: () => clock,
      isSessionLive: (s) => liveSessions.has(s),
      resolveSessionFile: (s) => sessionFiles.get(s),
      spawnDriver: async (req) => {
        spawns.push(req);
        return spawnResult;
      },
      killByToken: async (t) => {
        killedTokens.push(t);
        return true;
      },
      killBySession: async (s) => {
        killedSessions.push(s);
        return true;
      },
      buildReprime: (g) => `/goal ${g.objective}`,
      headlessAvailable: () => headless,
      setTimer: (fn, ms) => {
        const t: FakeTimer = { fn, ms, fired: false };
        timers.push(t);
        return t as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (t) => {
        const ft = t as unknown as FakeTimer;
        ft.fired = true; // mark cancelled so runTimers skips
      },
      log: () => {},
    });
  }

  async function runTimers(): Promise<void> {
    for (const t of timers) {
      if (!t.fired) {
        t.fired = true;
        t.fn();
      }
    }
    // let the async performSpawn chain settle (real store I/O)
    await new Promise((r) => setTimeout(r, 10));
  }

  async function death(sessionId: string): Promise<void> {
    await sup.onDriverDeath(sessionId);
  }

  async function get(id: string) {
    return (await store.list(cwd)).find((g) => g.id === id)!;
  }

  /** Create an active goal with a linked driver + a captured progress baseline. */
  async function activeGoal(opts: { autoRespawn?: boolean; totalTurns?: number } = {}) {
    const g = await store.create(cwd, { objective: "ship it", ...(opts.autoRespawn ? { autoRespawn: true } : {}) });
    await store.replaceDriver(cwd, g.id, "driver-1"); // baseline = totalTurnsUsed (0)
    if (opts.totalTurns) {
      await store.applyStatus(cwd, g.id, {
        status: "pursuing",
        lastKnownTurnsUsed: opts.totalTurns,
        turnsDelta: opts.totalTurns,
        progressed: true,
      });
    }
    liveSessions.add("driver-1");
    sessionFiles.set("driver-1", "/sessions/driver-1.jsonl");
    return get(g.id);
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-sup-"));
    store = createGoalStore({ dataDir });
    clock = 1_000_000;
    timers = [];
    spawns = [];
    killedTokens = [];
    killedSessions = [];
    liveSessions = new Set();
    sessionFiles = new Map();
    spawnResult = { success: true };
    headless = true;
    sup = makeSup();
  });

  afterEach(async () => {
    sup.dispose();
    store.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("ignores a death for a session that is not any goal's current driver", async () => {
    const g = await activeGoal({ autoRespawn: true });
    await death("some-other-session");
    expect((await get(g.id)).status).toBe("pursuing");
    expect(spawns).toHaveLength(0);
  });

  it("ignores a death on a terminal goal", async () => {
    const g = await activeGoal({ autoRespawn: true });
    await store.setStatus(cwd, g.id, "achieved");
    await death("driver-1");
    expect((await get(g.id)).status).toBe("achieved");
    expect(timers).toHaveLength(0);
  });

  it("autoRespawn off → paused 'session ended', no respawn", async () => {
    const g = await activeGoal({ autoRespawn: false });
    await death("driver-1");
    const rec = await get(g.id);
    expect(rec.status).toBe("paused");
    expect(rec.statusReason).toBe("session ended");
    expect(timers).toHaveLength(0);
  });

  it("headless unavailable → paused, no respawn", async () => {
    headless = false;
    const g = await activeGoal({ autoRespawn: true });
    await death("driver-1");
    expect((await get(g.id)).status).toBe("paused");
    expect(spawns).toHaveLength(0);
  });

  it("death after progress → respawning then resume (backoff 0), conversation preserved", async () => {
    const g = await activeGoal({ autoRespawn: true, totalTurns: 5 }); // total 5 > baseline 0
    await death("driver-1");
    // Immediately respawning (visible non-terminal), backoff 0.
    expect((await get(g.id)).status).toBe("respawning");
    expect(timers[0]!.ms).toBe(0);
    await runTimers();
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.reason).toBe("resume");
    expect(spawns[0]!.sessionFile).toBe("/sessions/driver-1.jsonl");
    // A respawn record was written with madeProgress true.
    const rec = await get(g.id);
    expect(rec.respawns![0]!.madeProgress).toBe(true);
    expect(rec.inFlightSpawn?.spawnToken).toBeTruthy();
  });

  it("no-progress deaths grow backoff 5s → 15s → 45s (spread beyond breaker window)", async () => {
    // Spread deaths beyond the rolling breaker window so the (window-scoped)
    // crash-loop breaker does not trip while the (window-independent)
    // consecutive-no-progress backoff index keeps growing to its 45s cap.
    const g = await activeGoal({ autoRespawn: true }); // total 0 == baseline 0 → no progress
    await death("driver-1");
    expect(timers.at(-1)!.ms).toBe(5_000);
    await runTimers();
    clock += BREAKER_WINDOW_MS + 1;
    await store.replaceDriver(cwd, g.id, "driver-1");
    await store.setInFlightSpawn(cwd, g.id, null);
    await store.setStatus(cwd, g.id, "pursuing");
    await death("driver-1");
    expect(timers.at(-1)!.ms).toBe(15_000);
    await runTimers();
    clock += BREAKER_WINDOW_MS + 1;
    await store.replaceDriver(cwd, g.id, "driver-1");
    await store.setStatus(cwd, g.id, "pursuing");
    await death("driver-1");
    expect(timers.at(-1)!.ms).toBe(45_000);
  });

  it("poison: K consecutive no-progress resume-deaths → fresh spawn re-primed", async () => {
    const g = await activeGoal({ autoRespawn: true });
    // Drive POISON_K no-progress resume deaths, each spread beyond the breaker
    // window so the crash-loop breaker (window-scoped) does not pre-empt the
    // poison strategy switch (which counts trailing resumes window-independently).
    for (let i = 0; i < POISON_K; i++) {
      await store.replaceDriver(cwd, g.id, "driver-1");
      await store.setStatus(cwd, g.id, "pursuing");
      await death("driver-1");
      await runTimers();
      clock += BREAKER_WINDOW_MS + 1;
    }
    // The (K+1)-th death should switch to fresh.
    await store.replaceDriver(cwd, g.id, "driver-1");
    await store.setStatus(cwd, g.id, "pursuing");
    await death("driver-1");
    await runTimers();
    const fresh = spawns.at(-1)!;
    expect(fresh.reason).toBe("fresh");
    expect(fresh.reprime).toContain("/goal ship it");
    expect(fresh.sessionFile).toBeUndefined();
  });

  it("resume downgrades to fresh (recorded reason matches) when the session file is gone", async () => {
    const g = await activeGoal({ autoRespawn: true, totalTurns: 3 }); // progress → resume intent
    sessionFiles.delete("driver-1"); // file gone → must fall back to fresh
    await death("driver-1");
    await runTimers();
    expect(spawns.at(-1)!.reason).toBe("fresh");
    expect(spawns.at(-1)!.sessionFile).toBeUndefined();
    // Persisted respawn reason matches the spawn actually executed (poison counter).
    expect((await get(g.id)).respawns!.at(-1)!.reason).toBe("fresh");
  });

  it("crash-loop breaker: BREAKER_COUNT no-progress deaths in window → failed 'crash loop'", async () => {
    const g = await activeGoal({ autoRespawn: true });
    for (let i = 0; i < BREAKER_COUNT - 1; i++) {
      await store.replaceDriver(cwd, g.id, "driver-1");
      await store.setStatus(cwd, g.id, "pursuing");
      await death("driver-1");
      await runTimers();
    }
    // The BREAKER_COUNT-th no-progress death trips.
    await store.replaceDriver(cwd, g.id, "driver-1");
    await store.setStatus(cwd, g.id, "pursuing");
    await death("driver-1");
    const rec = await get(g.id);
    expect(rec.status).toBe("failed");
    expect(rec.statusReason).toBe("crash loop");
  });

  it("progress prevents the breaker (counter resets)", async () => {
    const g = await activeGoal({ autoRespawn: true });
    // Two no-progress deaths.
    for (let i = 0; i < 2; i++) {
      await store.replaceDriver(cwd, g.id, "driver-1");
      await store.setStatus(cwd, g.id, "pursuing");
      await death("driver-1");
      await runTimers();
    }
    // Now a driver makes progress before dying: bump totalTurns past baseline,
    // and bump lastProgressAt (the breaker epoch) so prior deaths are excluded.
    await store.replaceDriver(cwd, g.id, "driver-1");
    clock += 1;
    await store.applyStatus(cwd, g.id, { status: "pursuing", lastKnownTurnsUsed: 9, turnsDelta: 9, progressed: true });
    await store.setStatus(cwd, g.id, "pursuing");
    await death("driver-1");
    // Progress death → respawning, NOT failed.
    expect((await get(g.id)).status).toBe("respawning");
  });

  it("abort: terminal-status-first, cancels timer, kills in-flight; the kill death is a no-op", async () => {
    const g = await activeGoal({ autoRespawn: true });
    await death("driver-1"); // schedules a backoff timer (no progress → 5s)
    expect(sup.pendingTimers()).toBe(1);
    // User clears the goal during backoff.
    await sup.abort(cwd, g.id, { status: "cleared", reason: "cleared by user" });
    const rec = await get(g.id);
    expect(rec.status).toBe("cleared");
    expect(rec.generation).toBe(1);
    expect(sup.pendingTimers()).toBe(0);
    // The backoff timer, if it somehow fires, must NOT spawn (generation changed).
    await runTimers();
    expect(spawns).toHaveLength(0);
    // A death arriving from our own kill is a no-op (already terminal).
    await death("driver-1");
    expect((await get(g.id)).status).toBe("cleared");
  });

  it("boot reconcile: orphaned pursuing goal with dead driver runs classify once", async () => {
    const g = await store.create(cwd, { objective: "o", autoRespawn: true });
    await store.replaceDriver(cwd, g.id, "dead-driver");
    await store.setStatus(cwd, g.id, "pursuing");
    // driver NOT live → reconcile classifies (no baseline progress → respawning)
    await sup.reconcileOnBoot();
    await new Promise((r) => setTimeout(r, 0));
    expect((await get(g.id)).status).toBe("respawning");
  });

  it("boot reconcile: goal whose driver is live is left pursuing", async () => {
    const g = await activeGoal({ autoRespawn: true });
    liveSessions.add("driver-1");
    await sup.reconcileOnBoot();
    expect((await get(g.id)).status).toBe("pursuing");
    expect(timers).toHaveLength(0);
  });
});
