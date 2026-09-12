/**
 * Tests for the main-server goal_status → durable status/turn projector.
 *
 * Covers spec scenarios from
 * `openspec/changes/persist-goal-status-and-progress/specs/goal-status-persistence/spec.md`.
 *
 * See change: persist-goal-status-and-progress (task 2.2).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGoalStatusProjector, type SessionGoalLookup } from "../goal-status-projector.js";
import { createGoalStore, type GoalStore } from "../goal-store.js";

async function waitFor(fn: () => Promise<boolean>, ms = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}
const flush = () => waitFor(async () => true, 30);

const snap = (status: string, turnsUsed: number) => ({ status, turnsUsed, maxTurns: 20 });

describe("goal-status-projector", () => {
  let dataDir: string;
  let store: GoalStore;
  const cwd = "/repo/x";

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-status-projector-"));
    store = createGoalStore({ dataDir, debounceMs: 5 });
  });
  afterEach(async () => {
    store.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function lookupFor(map: Record<string, string>): SessionGoalLookup {
    return (sid) => (map[sid] ? { goalId: map[sid], cwd } : null);
  }
  const cur = async () => (await store.list(cwd))[0]!;

  it("projects live status onto the durable record (active→pursuing, done→achieved)", async () => {
    const g = await store.create(cwd, { objective: "x" });
    await store.update(cwd, g.id, { status: "paused" }); // start off different
    const p = createGoalStatusProjector({ store, lookupSession: lookupFor({ s1: g.id }) });
    p.handle({ sessionId: "s1", payload: snap("active", 1) });
    await waitFor(async () => (await cur()).status === "pursuing");
    expect((await cur()).status).toBe("pursuing");
    p.handle({ sessionId: "s1", payload: snap("done", 2) });
    await waitFor(async () => (await cur()).status === "achieved");
    expect((await cur()).status).toBe("achieved");
  });

  it("ignores a snapshot from an unlinked session", async () => {
    await store.create(cwd, { objective: "x" });
    const p = createGoalStatusProjector({ store, lookupSession: () => null });
    p.handle({ sessionId: "s1", payload: snap("done", 3) });
    await flush();
    const rec = await cur();
    expect(rec.status).toBe("pursuing"); // unchanged default
    expect(rec.totalTurnsUsed).toBeUndefined();
  });

  it("does not rewrite the store for a redundant (same status + turns) snapshot", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const p = createGoalStatusProjector({ store, lookupSession: lookupFor({ s1: g.id }) });
    p.handle({ sessionId: "s1", payload: snap("active", 2) });
    await waitFor(async () => (await cur()).lastKnownTurnsUsed === 2);
    const firstUpdatedAt = (await cur()).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    p.handle({ sessionId: "s1", payload: snap("active", 2) }); // identical
    await flush();
    expect((await cur()).updatedAt).toBe(firstUpdatedAt); // no second write
  });

  it("accumulates totalTurnsUsed cumulatively across two drivers (0→3 then 0→2 = 5)", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const p = createGoalStatusProjector({
      store,
      lookupSession: lookupFor({ a: g.id, b: g.id }),
    });
    p.handle({ sessionId: "a", payload: snap("active", 0) });
    p.handle({ sessionId: "a", payload: snap("active", 3) });
    await waitFor(async () => (await cur()).totalTurnsUsed === 3);
    p.handle({ sessionId: "b", payload: snap("active", 0) });
    p.handle({ sessionId: "b", payload: snap("active", 2) });
    await waitFor(async () => (await cur()).totalTurnsUsed === 5);
    const rec = await cur();
    expect(rec.totalTurnsUsed).toBe(5);
    expect(rec.lastKnownTurnsUsed).toBe(2);
  });

  it("does not double-count a repeated turnsUsed", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const p = createGoalStatusProjector({ store, lookupSession: lookupFor({ s1: g.id }) });
    p.handle({ sessionId: "s1", payload: snap("active", 4) });
    p.handle({ sessionId: "s1", payload: snap("active", 4) });
    await waitFor(async () => (await cur()).totalTurnsUsed === 4);
    await flush();
    expect((await cur()).totalTurnsUsed).toBe(4);
  });

  it("stamps lastProgressAt only on a strict increase", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const p = createGoalStatusProjector({ store, lookupSession: lookupFor({ s1: g.id }) });
    p.handle({ sessionId: "s1", payload: snap("active", 2) });
    await waitFor(async () => (await cur()).lastProgressAt !== undefined);
    const t1 = (await cur()).lastProgressAt!;
    await new Promise((r) => setTimeout(r, 5));
    // paused status change with the SAME turns → status write, but no progress stamp.
    p.handle({ sessionId: "s1", payload: snap("paused", 2) });
    await waitFor(async () => (await cur()).status === "paused");
    expect((await cur()).lastProgressAt).toBe(t1);
    await new Promise((r) => setTimeout(r, 5));
    p.handle({ sessionId: "s1", payload: snap("active", 5) }); // strict increase
    await waitFor(async () => (await cur()).lastProgressAt! > t1);
    expect((await cur()).lastProgressAt!).toBeGreaterThan(t1);
  });

  it("counts a first-observed turnsUsed > 0 (missed zero baseline)", async () => {
    const g = await store.create(cwd, { objective: "x" });
    const p = createGoalStatusProjector({ store, lookupSession: lookupFor({ s1: g.id }) });
    p.handle({ sessionId: "s1", payload: snap("active", 3) }); // first snapshot already at 3
    await waitFor(async () => (await cur()).totalTurnsUsed === 3);
    expect((await cur()).totalTurnsUsed).toBe(3);
    expect((await cur()).lastProgressAt).toBeDefined();
  });
});
