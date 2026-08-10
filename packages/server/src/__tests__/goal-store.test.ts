/**
 * Tests for the folder-scoped goal record store.
 *
 * Covers spec scenarios from
 * `openspec/changes/add-goals-folder-page/specs/goals-folder-page/spec.md`
 * (Requirement: Folder-scoped goal record store + Goal-to-session linking).
 *
 * See change: add-goals-folder-page (task 1.1).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGoalStore, GoalNotFoundError, type GoalStore } from "../goal/goal-store.js";

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

  describe("applyStatus()", () => {
    it("projects status + turn fields and increments totalTurnsUsed cumulatively", async () => {
      const g = await store.create(cwdA, { objective: "proj" });
      await store.applyStatus(cwdA, g.id, {
        status: "pursuing",
        lastKnownTurnsUsed: 3,
        turnsDelta: 3,
        progressed: true,
      });
      let cur = (await store.list(cwdA))[0]!;
      expect(cur.status).toBe("pursuing");
      expect(cur.lastKnownTurnsUsed).toBe(3);
      expect(cur.totalTurnsUsed).toBe(3);
      expect(cur.lastProgressAt).toBeGreaterThan(0);

      await store.applyStatus(cwdA, g.id, {
        status: "achieved",
        lastKnownTurnsUsed: 2,
        turnsDelta: 2,
        progressed: true,
      });
      cur = (await store.list(cwdA))[0]!;
      expect(cur.status).toBe("achieved");
      expect(cur.lastKnownTurnsUsed).toBe(2);
      expect(cur.totalTurnsUsed).toBe(5); // 3 + 2, cumulative
    });

    it("does not stamp lastProgressAt when not progressed", async () => {
      const g = await store.create(cwdA, { objective: "noprog" });
      await store.applyStatus(cwdA, g.id, {
        status: "paused",
        lastKnownTurnsUsed: 0,
        turnsDelta: 0,
        progressed: false,
      });
      const cur = (await store.list(cwdA))[0]!;
      expect(cur.lastProgressAt).toBeUndefined();
      expect(cur.totalTurnsUsed).toBe(0);
    });

    it("loads a legacy record (no turn fields) and backfills on first applyStatus", async () => {
      // Hand-write a pre-change goals file lacking the new optional fields.
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(cwdA).digest("hex").slice(0, 12);
      const legacy = {
        schemaVersion: 1,
        goals: [
          {
            id: "legacy-1",
            cwd: cwdA,
            objective: "old",
            criteria: [],
            status: "pursuing",
            sessionIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      };
      await fs.writeFile(path.join(dataDir, `${hash}.json`), JSON.stringify(legacy));
      const reopened = createGoalStore({ dataDir });
      const before = (await reopened.list(cwdA))[0]!;
      expect(before.totalTurnsUsed).toBeUndefined();
      expect(before.lastKnownTurnsUsed).toBeUndefined();

      await reopened.applyStatus(cwdA, "legacy-1", {
        status: "pursuing",
        lastKnownTurnsUsed: 2,
        turnsDelta: 2,
        progressed: true,
      });
      const after = (await reopened.list(cwdA))[0]!;
      expect(after.totalTurnsUsed).toBe(2);
      expect(after.lastKnownTurnsUsed).toBe(2);
      reopened.dispose();
    });

    it("throws GoalNotFoundError for unknown id", async () => {
      await expect(
        store.applyStatus(cwdA, "nope", {
          status: "pursuing",
          lastKnownTurnsUsed: 0,
          turnsDelta: 0,
          progressed: false,
        }),
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

  // ── add-goal-session-supervisor (Phase 1) ──────────────────────────
  describe("supervisor fields", () => {
    it("seeds autoRespawn from create body; absent stays off", async () => {
      const on = await store.create(cwdA, { objective: "o", autoRespawn: true });
      expect(on.autoRespawn).toBe(true);
      const off = await store.create(cwdA, { objective: "o2" });
      expect(off.autoRespawn).toBeUndefined();
    });

    it("loads a legacy record (no supervisor fields) unchanged", async () => {
      // Hand-write a pre-change GoalsFile.
      const legacy = {
        schemaVersion: 1,
        goals: [
          {
            id: "legacy-1",
            cwd: cwdA,
            objective: "old",
            criteria: [],
            status: "pursuing",
            sessionIds: ["s1"],
            driverSessionId: "s1",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      };
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(cwdA).digest("hex").slice(0, 12);
      await fs.writeFile(path.join(dataDir, `${hash}.json`), JSON.stringify(legacy));
      const fresh = createGoalStore({ dataDir });
      const [g] = await fresh.list(cwdA);
      expect(g!.id).toBe("legacy-1");
      expect(g!.autoRespawn).toBeUndefined();
      expect(g!.respawns).toBeUndefined();
      fresh.dispose();
    });

    it("recordRespawn appends FIFO-capped", async () => {
      const g = await store.create(cwdA, { objective: "o" });
      for (let i = 0; i < 60; i++) {
        await store.recordRespawn(cwdA, g.id, { at: i, sessionId: `s${i}`, reason: "resume", madeProgress: false });
      }
      const [rec] = await store.list(cwdA);
      expect(rec!.respawns!.length).toBe(50);
      // Oldest dropped: first retained is the 11th (at=10).
      expect(rec!.respawns![0]!.at).toBe(10);
      expect(rec!.respawns![49]!.at).toBe(59);
    });

    it("replaceDriver swaps driver even when one is already set", async () => {
      const g = await store.create(cwdA, { objective: "o" });
      await store.linkSession(cwdA, g.id, "driver-1");
      const r = await store.replaceDriver(cwdA, g.id, "driver-2");
      expect(r.driverSessionId).toBe("driver-2");
      expect(r.sessionIds).toContain("driver-1");
      expect(r.sessionIds).toContain("driver-2");
    });

    it("setStatus writes status + reason", async () => {
      const g = await store.create(cwdA, { objective: "o" });
      const r = await store.setStatus(cwdA, g.id, "failed", "crash loop");
      expect(r.status).toBe("failed");
      expect(r.statusReason).toBe("crash loop");
    });

    it("finalize bumps generation, sets terminal status, clears in-flight spawn", async () => {
      const g = await store.create(cwdA, { objective: "o" });
      await store.setInFlightSpawn(cwdA, g.id, { spawnToken: "tok", generation: 0, startedAt: 1 });
      const r = await store.finalize(cwdA, g.id, { status: "cleared", statusReason: "cleared by user", clearInFlightSpawn: true });
      expect(r.status).toBe("cleared");
      expect(r.generation).toBe(1);
      expect(r.inFlightSpawn).toBeUndefined();
      // A second finalize bumps again (idempotent-safe monotonic).
      const r2 = await store.finalize(cwdA, g.id, { status: "cleared" });
      expect(r2.generation).toBe(2);
    });

    it("setInFlightSpawn sets then clears", async () => {
      const g = await store.create(cwdA, { objective: "o" });
      const set = await store.setInFlightSpawn(cwdA, g.id, { spawnToken: "t", generation: 3, startedAt: 9 });
      expect(set.inFlightSpawn).toEqual({ spawnToken: "t", generation: 3, startedAt: 9 });
      const cleared = await store.setInFlightSpawn(cwdA, g.id, null);
      expect(cleared.inFlightSpawn).toBeUndefined();
    });

    it("listAll enumerates goals across folder files", async () => {
      await store.create(cwdA, { objective: "a" });
      await store.create(cwdB, { objective: "b1" });
      await store.create(cwdB, { objective: "b2" });
      const all = await store.listAll();
      expect(all.map((g) => g.objective).sort()).toEqual(["a", "b1", "b2"]);
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
