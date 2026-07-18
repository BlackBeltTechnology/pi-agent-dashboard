/**
 * Tests for the OpenSpec change-grouping store.
 *
 * Covers tasks 2.15–2.17 + spec scenarios from
 * `openspec/changes/add-openspec-change-grouping/specs/openspec-change-grouping/spec.md`.
 *
 * See change: add-openspec-change-grouping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createOpenSpecGroupStore,
  ConcurrentEditError,
  UnsupportedSchemaVersionError,
  GroupNotFoundError,
  UnknownGroupIdError,
  type OpenSpecGroupStore,
} from "../openspec/openspec-group-store.js";
import { OPENSPEC_GROUPS_SCHEMA_VERSION } from "@blackbelt-technology/pi-dashboard-shared/types.js";

describe("openspec-group-store", () => {
  let tmpDir: string;
  let cwd: string;
  let groupsFile: string;
  let store: OpenSpecGroupStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ogs-"));
    cwd = tmpDir;
    groupsFile = path.join(cwd, "openspec", "groups", "groups.json");
    store = createOpenSpecGroupStore();
  });

  afterEach(async () => {
    store.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Read path ────────────────────────────────────────────────

  describe("read()", () => {
    it("returns the default-empty payload when the file is absent and does NOT create the directory", async () => {
      const data = await store.read(cwd);
      expect(data).toEqual({ schemaVersion: 1, groups: [], assignments: {} });

      const dirExists = await fs.stat(path.join(cwd, "openspec", "groups")).then(
        () => true,
        () => false,
      );
      expect(dirExists).toBe(false);
    });

    it("returns parsed contents verbatim when file present", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(
        groupsFile,
        JSON.stringify({
          schemaVersion: 1,
          groups: [{ id: "ui", name: "UI", color: "#3b82f6", order: 0 }],
          assignments: { "add-foo": "ui" },
        }),
      );
      const data = await store.read(cwd);
      expect(data.groups).toEqual([{ id: "ui", name: "UI", color: "#3b82f6", order: 0 }]);
      expect(data.assignments).toEqual({ "add-foo": "ui" });
    });

    it("returns cached data on unchanged (mtime, size) without calling readFile", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(
        groupsFile,
        JSON.stringify({ schemaVersion: 1, groups: [], assignments: {} }),
      );
      // Prime the cache.
      await store.read(cwd);
      const readSpy = vi.spyOn(fs, "readFile");
      // Second read should be a cache hit — no readFile.
      await store.read(cwd);
      await store.read(cwd);
      expect(readSpy).not.toHaveBeenCalled();
      readSpy.mockRestore();
    });

    it("re-reads when mtime changes", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(
        groupsFile,
        JSON.stringify({ schemaVersion: 1, groups: [], assignments: {} }),
      );
      const first = await store.read(cwd);
      expect(first.groups).toHaveLength(0);
      // Bump mtime and content.
      await new Promise((r) => setTimeout(r, 10));
      const future = new Date(Date.now() + 60_000);
      await fs.writeFile(
        groupsFile,
        JSON.stringify({
          schemaVersion: 1,
          groups: [{ id: "ui", name: "UI", order: 0 }],
          assignments: {},
        }),
      );
      await fs.utimes(groupsFile, future, future);
      const second = await store.read(cwd);
      expect(second.groups).toHaveLength(1);
      expect(second.groups[0]?.id).toBe("ui");
    });

    it("detects within-same-second writes via size delta", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      const base = { schemaVersion: 1, groups: [], assignments: {} };
      await fs.writeFile(groupsFile, JSON.stringify(base));
      const stat1 = await fs.stat(groupsFile);
      await store.read(cwd);
      // Write with same mtime but larger size.
      const bigger = {
        schemaVersion: 1,
        groups: [{ id: "ui", name: "UI", order: 0 }],
        assignments: {},
      };
      await fs.writeFile(groupsFile, JSON.stringify(bigger));
      await fs.utimes(groupsFile, stat1.atime, stat1.mtime); // force same mtime
      const data = await store.read(cwd);
      expect(data.groups).toHaveLength(1);
    });

    it("clears the cache and returns default when the file is deleted", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(
        groupsFile,
        JSON.stringify({
          schemaVersion: 1,
          groups: [{ id: "ui", name: "UI", order: 0 }],
          assignments: {},
        }),
      );
      const first = await store.read(cwd);
      expect(first.groups).toHaveLength(1);
      await fs.rm(groupsFile);
      const second = await store.read(cwd);
      expect(second).toEqual({ schemaVersion: 1, groups: [], assignments: {} });
    });

    it("shares one readFile call across concurrent reads in the same tick", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(
        groupsFile,
        JSON.stringify({ schemaVersion: 1, groups: [], assignments: {} }),
      );
      const readSpy = vi.spyOn(fs, "readFile");
      const reads = await Promise.all([store.read(cwd), store.read(cwd), store.read(cwd), store.read(cwd), store.read(cwd)]);
      expect(reads.every((r) => r.schemaVersion === 1)).toBe(true);
      // First batch: 1 readFile call shared across 5 reads.
      expect(readSpy).toHaveBeenCalledTimes(1);
      readSpy.mockRestore();
    });

    it("rejects unknown schemaVersion with UnsupportedSchemaVersionError", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(groupsFile, JSON.stringify({ schemaVersion: 2, groups: [], assignments: {} }));
      await expect(store.read(cwd)).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
    });

    it("rejects missing schemaVersion field with UnsupportedSchemaVersionError", async () => {
      await fs.mkdir(path.dirname(groupsFile), { recursive: true });
      await fs.writeFile(groupsFile, JSON.stringify({ groups: [], assignments: {} }));
      await expect(store.read(cwd)).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
    });
  });

  // ── createGroup ──────────────────────────────────────────────

  describe("createGroup()", () => {
    it("creates the file + directory on first write", async () => {
      const g = await store.createGroup(cwd, { name: "UI", color: "#3b82f6" });
      expect(g.id).toBe("ui");
      expect(g.name).toBe("UI");
      expect(g.order).toBe(0);
      const raw = await fs.readFile(groupsFile, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe(OPENSPEC_GROUPS_SCHEMA_VERSION);
      expect(parsed.groups).toHaveLength(1);
      expect(parsed.assignments).toEqual({});
    });

    it("appends collision suffix when slug already exists", async () => {
      await store.createGroup(cwd, { name: "UI" });
      const second = await store.createGroup(cwd, { name: "UI" });
      expect(second.id).toBe("ui-2");
      const third = await store.createGroup(cwd, { name: "UI" });
      expect(third.id).toBe("ui-3");
    });

    it("auto-assigns order = groups.length", async () => {
      const a = await store.createGroup(cwd, { name: "UI" });
      const b = await store.createGroup(cwd, { name: "Server" });
      expect(a.order).toBe(0);
      expect(b.order).toBe(1);
    });

    it("serializes concurrent creates for the same cwd via FIFO mutex", async () => {
      const [a, b, c] = await Promise.all([
        store.createGroup(cwd, { name: "A" }),
        store.createGroup(cwd, { name: "B" }),
        store.createGroup(cwd, { name: "C" }),
      ]);
      const data = await store.read(cwd);
      expect(data.groups).toHaveLength(3);
      const ids = new Set(data.groups.map((g) => g.id));
      expect(ids.has(a.id)).toBe(true);
      expect(ids.has(b.id)).toBe(true);
      expect(ids.has(c.id)).toBe(true);
      // Orders are contiguous 0..2.
      const orders = data.groups.map((g) => g.order).sort();
      expect(orders).toEqual([0, 1, 2]);
    });
  });

  // ── updateGroup ──────────────────────────────────────────────

  describe("updateGroup()", () => {
    it("renames without changing id", async () => {
      const g = await store.createGroup(cwd, { name: "UI" });
      const updated = await store.updateGroup(cwd, g.id, { name: "Frontend" });
      expect(updated.id).toBe("ui");
      expect(updated.name).toBe("Frontend");
    });

    it("throws GroupNotFoundError on unknown id", async () => {
      await expect(store.updateGroup(cwd, "does-not-exist", { name: "X" })).rejects.toBeInstanceOf(
        GroupNotFoundError,
      );
    });

    it("normalizes order to contiguous 0..N-1 after a reorder", async () => {
      const a = await store.createGroup(cwd, { name: "A" }); // order 0
      const b = await store.createGroup(cwd, { name: "B" }); // order 1
      const c = await store.createGroup(cwd, { name: "C" }); // order 2
      // Move A to the end.
      await store.updateGroup(cwd, a.id, { order: 5 });
      const data = await store.read(cwd);
      const byId = new Map(data.groups.map((g) => [g.id, g.order]));
      const orders = [...byId.values()].sort();
      expect(orders).toEqual([0, 1, 2]);
      // A should be last (highest order).
      expect(byId.get(a.id)).toBe(2);
      expect(byId.get(b.id)).toBe(0);
      expect(byId.get(c.id)).toBe(1);
    });
  });

  // ── deleteGroup ──────────────────────────────────────────────

  describe("deleteGroup()", () => {
    it("removes the group", async () => {
      const g = await store.createGroup(cwd, { name: "UI" });
      await store.deleteGroup(cwd, g.id);
      const data = await store.read(cwd);
      expect(data.groups).toHaveLength(0);
    });

    it("cascades through assignments referencing the deleted group", async () => {
      const g = await store.createGroup(cwd, { name: "UI" });
      const other = await store.createGroup(cwd, { name: "Server" });
      await store.setAssignment(cwd, "add-foo", g.id);
      await store.setAssignment(cwd, "fix-bar", other.id);
      await store.deleteGroup(cwd, g.id);
      const data = await store.read(cwd);
      expect(data.assignments).toEqual({ "fix-bar": other.id });
    });

    it("throws GroupNotFoundError on unknown id", async () => {
      await expect(store.deleteGroup(cwd, "does-not-exist")).rejects.toBeInstanceOf(GroupNotFoundError);
    });

    it("re-packs orders contiguously after delete", async () => {
      const a = await store.createGroup(cwd, { name: "A" });
      const b = await store.createGroup(cwd, { name: "B" });
      const c = await store.createGroup(cwd, { name: "C" });
      await store.deleteGroup(cwd, b.id);
      const data = await store.read(cwd);
      const byId = new Map(data.groups.map((g) => [g.id, g.order]));
      // Surviving orders should be contiguous 0..1.
      const orders = [...byId.values()].sort();
      expect(orders).toEqual([0, 1]);
      expect(byId.get(a.id)).toBe(0);
      expect(byId.get(c.id)).toBe(1);
    });
  });

  // ── setAssignment ────────────────────────────────────────────

  describe("setAssignment()", () => {
    it("adds a single map entry", async () => {
      const g = await store.createGroup(cwd, { name: "UI" });
      await store.setAssignment(cwd, "add-foo", g.id);
      const data = await store.read(cwd);
      expect(data.assignments).toEqual({ "add-foo": g.id });
    });

    it("replaces previous group on reassignment", async () => {
      const g1 = await store.createGroup(cwd, { name: "UI" });
      const g2 = await store.createGroup(cwd, { name: "Server" });
      await store.setAssignment(cwd, "add-foo", g1.id);
      await store.setAssignment(cwd, "add-foo", g2.id);
      const data = await store.read(cwd);
      expect(data.assignments).toEqual({ "add-foo": g2.id });
    });

    it("removes the entry on null", async () => {
      const g = await store.createGroup(cwd, { name: "UI" });
      await store.setAssignment(cwd, "add-foo", g.id);
      await store.setAssignment(cwd, "add-foo", null);
      const data = await store.read(cwd);
      expect(data.assignments).toEqual({});
    });

    it("throws UnknownGroupIdError on unknown groupId", async () => {
      await expect(store.setAssignment(cwd, "add-foo", "does-not-exist")).rejects.toBeInstanceOf(
        UnknownGroupIdError,
      );
    });

    it("tolerates unknown changeName", async () => {
      const g = await store.createGroup(cwd, { name: "UI" });
      await store.setAssignment(cwd, "never-existed", g.id);
      const data = await store.read(cwd);
      expect(data.assignments).toEqual({ "never-existed": g.id });
    });
  });

  // ── Concurrency: FIFO mutex + cwd isolation ──────────────────

  describe("concurrency", () => {
    it("two concurrent writes to the same cwd produce both results (no lost write)", async () => {
      // Both should serialize and both succeed.
      const [a, b] = await Promise.all([
        store.createGroup(cwd, { name: "A" }),
        store.createGroup(cwd, { name: "B" }),
      ]);
      const data = await store.read(cwd);
      const ids = new Set(data.groups.map((g) => g.id));
      expect(ids.has(a.id)).toBe(true);
      expect(ids.has(b.id)).toBe(true);
    });

    it("concurrent writes to different cwds proceed in parallel", async () => {
      const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "ogs2-"));
      try {
        const [a, b] = await Promise.all([
          store.createGroup(cwd, { name: "A" }),
          store.createGroup(tmpDir2, { name: "B" }),
        ]);
        expect(a.id).toBe("a");
        expect(b.id).toBe("b");
      } finally {
        await fs.rm(tmpDir2, { recursive: true, force: true });
      }
    });
  });

  // ── 1-shot retry on hand-edit race ───────────────────────────

  describe("hand-edit race detection", () => {
    it("retries once and succeeds when the file is hand-edited between read and rename", async () => {
      let triggered = false;
      const racingStore = createOpenSpecGroupStore({
        __testHookBeforeRename: async () => {
          if (triggered) return;
          triggered = true;
          // Simulate a hand-edit: write a different version of the file.
          await fs.mkdir(path.dirname(groupsFile), { recursive: true });
          const future = new Date(Date.now() + 60_000);
          await fs.writeFile(
            groupsFile,
            JSON.stringify({
              schemaVersion: 1,
              groups: [{ id: "external", name: "External", order: 0 }],
              assignments: {},
            }),
          );
          await fs.utimes(groupsFile, future, future);
        },
      });
      try {
        const created = await racingStore.createGroup(cwd, { name: "UI" });
        expect(created.name).toBe("UI");
        // Final file should contain BOTH the external group and the dashboard one.
        const data = await racingStore.read(cwd);
        const ids = new Set(data.groups.map((g) => g.id));
        expect(ids.has("external")).toBe(true);
        expect(ids.has(created.id)).toBe(true);
      } finally {
        racingStore.dispose();
      }
    });

    it("throws ConcurrentEditError after a sustained race (two strikes)", async () => {
      let strikes = 0;
      const racingStore = createOpenSpecGroupStore({
        __testHookBeforeRename: async () => {
          strikes++;
          // Always race — simulate sustained external editor.
          await fs.mkdir(path.dirname(groupsFile), { recursive: true });
          const future = new Date(Date.now() + 60_000 * strikes);
          await fs.writeFile(
            groupsFile,
            JSON.stringify({
              schemaVersion: 1,
              groups: [{ id: "external", name: `External-${strikes}`, order: 0 }],
              assignments: {},
            }),
          );
          await fs.utimes(groupsFile, future, future);
        },
      });
      try {
        await expect(racingStore.createGroup(cwd, { name: "UI" })).rejects.toBeInstanceOf(
          ConcurrentEditError,
        );
        // Hook fires twice: once for the original write, once for the retry.
        expect(strikes).toBe(2);
      } finally {
        racingStore.dispose();
      }
    });
  });

  // ── Subscribe / debounced broadcast ──────────────────────────

  describe("subscribe() — debounced broadcast", () => {
    it("emits a single broadcast for one write within the debounce window", async () => {
      vi.useFakeTimers();
      const fast = createOpenSpecGroupStore({ debounceMs: 100 });
      const events: Array<{ cwd: string; payload: unknown }> = [];
      fast.subscribe((cwd, payload) => events.push({ cwd, payload }));
      try {
        await fast.createGroup(cwd, { name: "UI" });
        // Before the debounce window elapses, no broadcast yet.
        expect(events).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(100);
        expect(events).toHaveLength(1);
        expect(events[0]?.cwd).toBe(cwd);
      } finally {
        vi.useRealTimers();
        fast.dispose();
      }
    });

    it("coalesces 5 writes within 100 ms into 1 broadcast", async () => {
      vi.useFakeTimers();
      const fast = createOpenSpecGroupStore({ debounceMs: 100 });
      const events: Array<{ cwd: string; payload: { groups: Array<{ id: string }> } }> = [];
      fast.subscribe((c, p) => events.push({ cwd: c, payload: p as any }));
      try {
        await fast.createGroup(cwd, { name: "A" });
        await fast.createGroup(cwd, { name: "B" });
        await fast.createGroup(cwd, { name: "C" });
        await fast.createGroup(cwd, { name: "D" });
        await fast.createGroup(cwd, { name: "E" });
        // Still inside debounce window.
        await vi.advanceTimersByTimeAsync(50);
        expect(events).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(100);
        expect(events).toHaveLength(1);
        expect(events[0]?.payload.groups).toHaveLength(5);
      } finally {
        vi.useRealTimers();
        fast.dispose();
      }
    });

    it("does NOT coalesce broadcasts across different cwds", async () => {
      const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "ogs2-"));
      vi.useFakeTimers();
      const fast = createOpenSpecGroupStore({ debounceMs: 100 });
      const events: Array<{ cwd: string }> = [];
      fast.subscribe((c) => events.push({ cwd: c }));
      try {
        await fast.createGroup(cwd, { name: "A" });
        await fast.createGroup(tmpDir2, { name: "B" });
        await vi.advanceTimersByTimeAsync(100);
        expect(events).toHaveLength(2);
        const cwds = new Set(events.map((e) => e.cwd));
        expect(cwds.has(cwd)).toBe(true);
        expect(cwds.has(tmpDir2)).toBe(true);
      } finally {
        vi.useRealTimers();
        fast.dispose();
        await fs.rm(tmpDir2, { recursive: true, force: true });
      }
    });
  });
});
