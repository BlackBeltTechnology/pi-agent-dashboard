/**
 * Tests for the main-server goal_status → verdict accumulator.
 *
 * See change: sophisticate-goal-authoring-and-control (task 2.2).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGoalStore, type GoalStore } from "../goal/goal-store.js";
import { createGoalVerdictAccumulator, type SessionGoalLookup } from "../goal/goal-verdict-accumulator.js";

/** Poll until a condition is met, with timeout. */
async function waitFor(fn: () => Promise<boolean>, ms = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}
const flush = () => waitFor(async () => true, 30);

describe("goal-verdict-accumulator", () => {
  let dataDir: string;
  let store: GoalStore;
  const cwd = "/repo/x";

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-verdict-"));
    store = createGoalStore({ dataDir, debounceMs: 5 });
  });
  afterEach(async () => {
    store.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function lookupFor(sessionId: string, goalId: string): SessionGoalLookup {
    return (sid) => (sid === sessionId ? { goalId, cwd } : null);
  }

  it("appends a verdict when a linked snapshot advances", async () => {
    const g = await store.create(cwd, { objective: "judged" });
    const acc = createGoalVerdictAccumulator({ store, lookupSession: lookupFor("s1", g.id) });
    acc.handle({ sessionId: "s1", payload: { status: "active", turnsUsed: 1, maxTurns: 20, lastVerdict: "continue", lastReason: null } });
    await waitFor(async () => ((await store.list(cwd))[0]?.verdicts?.length ?? 0) >= 1);
    const cur = (await store.list(cwd))[0]!;
    expect(cur.verdicts).toHaveLength(1);
    expect(cur.verdicts![0]).toMatchObject({ turn: 1, verdict: "continue", note: "continue" });
  });

  it("does not append for an unlinked session", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const acc = createGoalVerdictAccumulator({ store, lookupSession: () => null });
    acc.handle({ sessionId: "s1", payload: { status: "active", turnsUsed: 1, maxTurns: 20, lastVerdict: "continue", lastReason: null } });
    await flush();
    expect((await store.list(cwd))[0]!.verdicts).toBeUndefined();
  });

  it("ignores duplicate snapshots (no advance)", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const acc = createGoalVerdictAccumulator({ store, lookupSession: lookupFor("s1", g.id) });
    const snap = { status: "active", turnsUsed: 2, maxTurns: 20, lastVerdict: "continue", lastReason: null };
    acc.handle({ sessionId: "s1", payload: snap });
    acc.handle({ sessionId: "s1", payload: { ...snap } });
    await waitFor(async () => ((await store.list(cwd))[0]?.verdicts?.length ?? 0) >= 1);
    expect((await store.list(cwd))[0]!.verdicts).toHaveLength(1);
  });

  it("maps paused + done status to verdict kinds", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const acc = createGoalVerdictAccumulator({ store, lookupSession: lookupFor("s1", g.id) });
    acc.handle({ sessionId: "s1", payload: { status: "paused", turnsUsed: 3, maxTurns: 20, lastVerdict: null, lastReason: "budget" } });
    acc.handle({ sessionId: "s1", payload: { status: "done", turnsUsed: 4, maxTurns: 20, lastVerdict: "satisfied", lastReason: null } });
    await waitFor(async () => ((await store.list(cwd))[0]?.verdicts?.length ?? 0) >= 2);
    const v = (await store.list(cwd))[0]!.verdicts!;
    expect(v.map((x) => x.verdict)).toEqual(["paused", "satisfied"]);
    expect(v[0]!.note).toBe("budget"); // falls back to lastReason when no verdict
  });

  it("resets tracking on cleared so a future run re-appends turn 0", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const acc = createGoalVerdictAccumulator({ store, lookupSession: lookupFor("s1", g.id) });
    acc.handle({ sessionId: "s1", payload: { status: "active", turnsUsed: 5, maxTurns: 20, lastVerdict: "continue", lastReason: null } });
    acc.handle({ sessionId: "s1", payload: { status: "cleared", turnsUsed: 0, maxTurns: 20, lastVerdict: null, lastReason: null } });
    acc.handle({ sessionId: "s1", payload: { status: "active", turnsUsed: 0, maxTurns: 20, lastVerdict: "continue", lastReason: null } });
    await waitFor(async () => ((await store.list(cwd))[0]?.verdicts?.length ?? 0) >= 2);
    const v = (await store.list(cwd))[0]!.verdicts!;
    expect(v.map((x) => x.turn)).toEqual([5, 0]);
  });
});
