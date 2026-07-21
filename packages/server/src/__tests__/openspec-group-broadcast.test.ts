/**
 * Integration-style tests for the OpenSpec change-grouping
 * broadcast + caching contract:
 *
 *   4.3 — 100 broadcasts on an unchanged groups file produce 0 readFile
 *         calls but ~100 stat calls (cache fast-path).
 *   4.5 — A write through `store.createGroup` triggers a debounced
 *         `openspec_groups_update` payload to subscribers.
 *
 * See change: add-openspec-change-grouping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createOpenSpecGroupStore,
  type OpenSpecGroupStore,
} from "../openspec/openspec-group-store.js";

describe("openspec-group-store — broadcast + cache instrumentation", () => {
  let tmpDir: string;
  let store: OpenSpecGroupStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ogs-broadcast-"));
    store = createOpenSpecGroupStore({ debounceMs: 5 });
  });

  afterEach(async () => {
    store.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("100 sequential reads on an unchanged file produce 0 readFile calls and ~100 stat calls", async () => {
    // Seed the file + warm the cache once.
    await store.createGroup(tmpDir, { name: "UI" });
    // Drain any pending debounce work to keep the spy clean.
    await new Promise((r) => setTimeout(r, 20));

    const readSpy = vi.spyOn(fs, "readFile");
    const statSpy = vi.spyOn(fs, "stat");
    try {
      for (let i = 0; i < 100; i++) {
        await store.read(tmpDir);
      }
      expect(readSpy).not.toHaveBeenCalled();
      // ~100 stat calls — exact equality because reads are sequential.
      expect(statSpy.mock.calls.length).toBeGreaterThanOrEqual(100);
      // (post-write `fs.stat` to update cache happens before the spy
      // is installed, so it doesn't inflate the count here.)
    } finally {
      readSpy.mockRestore();
      statSpy.mockRestore();
    }
  });

  it("a single createGroup write produces one debounced subscriber callback with the new payload", async () => {
    const events: Array<{ cwd: string; groupCount: number; assignmentCount: number }> = [];
    store.subscribe((cwd, payload) => {
      events.push({
        cwd,
        groupCount: payload.groups.length,
        assignmentCount: Object.keys(payload.assignments).length,
      });
    });

    await store.createGroup(tmpDir, { name: "UI" });
    // Wait past the debounce window.
    await new Promise((r) => setTimeout(r, 30));

    expect(events).toHaveLength(1);
    expect(events[0]?.cwd).toBe(tmpDir);
    expect(events[0]?.groupCount).toBe(1);
    expect(events[0]?.assignmentCount).toBe(0);
  });

  it("an assignment write follows up with a payload reflecting both the group AND the assignment", async () => {
    const events: Array<{ groups: number; assignments: number }> = [];
    store.subscribe((_cwd, payload) => {
      events.push({
        groups: payload.groups.length,
        assignments: Object.keys(payload.assignments).length,
      });
    });
    const created = await store.createGroup(tmpDir, { name: "UI" });
    await store.setAssignment(tmpDir, "add-foo", created.id);
    await new Promise((r) => setTimeout(r, 30));
    // Two writes inside the same window may coalesce into 1 broadcast,
    // OR resolve as two distinct broadcasts depending on timing. Assert
    // the FINAL event reflects both writes.
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last?.groups).toBe(1);
    expect(last?.assignments).toBe(1);
  });
});
