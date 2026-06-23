/**
 * Tests for the folder-scoped goal record store.
 *
 * Covers spec scenarios from
 * `openspec/changes/add-goals-folder-page/specs/goals-folder-page/spec.md`
 * (Requirement: Folder-scoped goal record store + Goal-to-session linking).
 *
 * See change: add-goals-folder-page (task 1.1).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createGoalStore, GoalNotFoundError, type GoalStore } from "../goal-store.js";

describe("goal-store", () => {
  let dataDir: string;
  let store: GoalStore;
  const cwdA = "/repo/alpha";
  const cwdB = "/repo/beta";

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-store-"));
    store = createGoalStore({ dataDir });
  });

  afterEach(async () => {
    store.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe("read()", () => {
    it("returns empty list when no file exists", async () => {
      expect(await store.list(cwdA)).toEqual([]);
    });
  });

  describe("create()", () => {
    it("persists a GoalRecord with defaults", async () => {
      const g = await store.create(cwdA, { objective: "Ship goals page" });
      expect(g.id).toBeTruthy();
      expect(g.cwd).toBe(cwdA);
      expect(g.objective).toBe("Ship goals page");
      expect(g.status).toBe("pursuing");
      expect(g.sessionIds).toEqual([]);
      expect(g.criteria).toEqual([]);
      expect(g.createdAt).toBeGreaterThan(0);
      expect(g.updatedAt).toBe(g.createdAt);

      const list = await store.list(cwdA);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(g.id);
    });

    it("survives a store reload (new instance, same dataDir)", async () => {
      const g = await store.create(cwdA, { objective: "persist me" });
      const reopened = createGoalStore({ dataDir });
      const list = await reopened.list(cwdA);
      expect(list.map((x) => x.id)).toContain(g.id);
      reopened.dispose();
    });

    it("accepts criteria + budget", async () => {
      const g = await store.create(cwdA, {
        objective: "with extras",
        criteria: [{ text: "tests pass", done: false }],
        budget: { maxTurns: 30 },
      });
      expect(g.criteria).toEqual([{ text: "tests pass", done: false }]);
      expect(g.budget).toEqual({ maxTurns: 30 });
    });
  });

  describe("folder scoping", () => {
    it("only returns goals for the requested cwd", async () => {
      await store.create(cwdA, { objective: "a" });
      await store.create(cwdB, { objective: "b" });
      const a = await store.list(cwdA);
      const b = await store.list(cwdB);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.objective).toBe("a");
      expect(b[0]!.objective).toBe("b");
    });
  });

  describe("update()", () => {
    it("patches status/objective/criteria/budget and bumps updatedAt", async () => {
      const g = await store.create(cwdA, { objective: "orig" });
      await new Promise((r) => setTimeout(r, 2));
      const updated = await store.update(cwdA, g.id, { status: "paused", objective: "new" });
      expect(updated.status).toBe("paused");
      expect(updated.objective).toBe("new");
      expect(updated.updatedAt).toBeGreaterThanOrEqual(g.updatedAt);
    });

    it("throws GoalNotFoundError for unknown id", async () => {
      await expect(store.update(cwdA, "nope", { status: "achieved" })).rejects.toBeInstanceOf(
        GoalNotFoundError,
      );
    });
  });

  describe("delete()", () => {
    it("removes the goal and returns its former sessionIds", async () => {
      const g = await store.create(cwdA, { objective: "del" });
      await store.linkSession(cwdA, g.id, "sess-1");
      const removedSessionIds = await store.delete(cwdA, g.id);
      expect(removedSessionIds).toEqual(["sess-1"]);
      expect(await store.list(cwdA)).toEqual([]);
    });

    it("throws GoalNotFoundError for unknown id", async () => {
      await expect(store.delete(cwdA, "nope")).rejects.toBeInstanceOf(GoalNotFoundError);
    });
  });

  describe("session linking", () => {
    it("links a session (idempotent) and unlinks it", async () => {
      const g = await store.create(cwdA, { objective: "link" });
      await store.linkSession(cwdA, g.id, "s1");
      await store.linkSession(cwdA, g.id, "s1"); // idempotent
      let cur = (await store.list(cwdA))[0]!;
      expect(cur.sessionIds).toEqual(["s1"]);

      await store.unlinkSession(cwdA, g.id, "s1");
      cur = (await store.list(cwdA))[0]!;
      expect(cur.sessionIds).toEqual([]);
    });

    it("sets driverSessionId on first link when absent", async () => {
      const g = await store.create(cwdA, { objective: "driver" });
      await store.linkSession(cwdA, g.id, "s1");
      const cur = (await store.list(cwdA))[0]!;
      expect(cur.driverSessionId).toBe("s1");
    });
  });

  describe("appendVerdict()", () => {
    it("appends verdicts newest-last and FIFO-caps at 50", async () => {
      const g = await store.create(cwdA, { objective: "judged" });
      for (let i = 0; i < 60; i++) {
        await store.appendVerdict(cwdA, g.id, { turn: i, at: i, verdict: "continue" });
      }
      const cur = (await store.list(cwdA))[0]!;
      expect(cur.verdicts).toHaveLength(50);
      expect(cur.verdicts![0]!.turn).toBe(10); // oldest 10 dropped
      expect(cur.verdicts![49]!.turn).toBe(59); // newest retained
    });

    it("throws GoalNotFoundError for unknown id", async () => {
      await expect(
        store.appendVerdict(cwdA, "nope", { turn: 1, at: 1, verdict: "continue" }),
      ).rejects.toBeInstanceOf(GoalNotFoundError);
    });
  });

  describe("judge field", () => {
    it("persists judge on create and update", async () => {
      const g = await store.create(cwdA, { objective: "j", judge: { provider: "p", modelId: "m" } });
      expect(g.judge).toEqual({ provider: "p", modelId: "m" });
      const u = await store.update(cwdA, g.id, { judge: { provider: "p2", modelId: "m2", sameModel: true } });
      expect(u.judge).toEqual({ provider: "p2", modelId: "m2", sameModel: true });
    });
  });

  describe("subscribe()", () => {
    it("fires after a mutation with the cwd + goals payload", async () => {
      const events: { cwd: string; goals: unknown[] }[] = [];
      const unsub = store.subscribe((cwd, payload) => events.push({ cwd, goals: payload.goals }));
      await store.create(cwdA, { objective: "notify" });
      await new Promise((r) => setTimeout(r, 150));
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1]!.cwd).toBe(cwdA);
      expect(events[events.length - 1]!.goals).toHaveLength(1);
      unsub();
    });
  });
});
