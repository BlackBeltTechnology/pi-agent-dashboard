/**
 * Tests for per-change ordering persistence in the OpenSpec group store.
 * See change: redesign-openspec-board (openspec-change-order spec).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createOpenSpecGroupStore, type OpenSpecGroupStore } from "../openspec/openspec-group-store.js";
import { OPENSPEC_UNGROUPED_KEY } from "@blackbelt-technology/pi-dashboard-shared/types.js";

describe("openspec-group-store: change order", () => {
  let cwd: string;
  let store: OpenSpecGroupStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "oco-"));
    store = createOpenSpecGroupStore();
  });
  afterEach(async () => {
    store.dispose();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("persists a per-group change order that survives reload", async () => {
    await store.setChangeOrder(cwd, "ui", ["b-change", "a-change"]);
    const fresh = createOpenSpecGroupStore();
    try {
      const file = await fresh.read(cwd);
      expect(file.changeOrder?.["ui"]).toEqual(["b-change", "a-change"]);
    } finally {
      fresh.dispose();
    }
  });

  it("keeps order per-group (other groups unaffected)", async () => {
    await store.setChangeOrder(cwd, "ui", ["a-change"]);
    await store.setChangeOrder(cwd, "backlog", ["x-change", "y-change"]);
    const file = await store.read(cwd);
    expect(file.changeOrder?.["ui"]).toEqual(["a-change"]);
    expect(file.changeOrder?.["backlog"]).toEqual(["x-change", "y-change"]);
  });

  it("supports the implicit Ungrouped key", async () => {
    await store.setChangeOrder(cwd, OPENSPEC_UNGROUPED_KEY, ["lone-change"]);
    const file = await store.read(cwd);
    expect(file.changeOrder?.[OPENSPEC_UNGROUPED_KEY]).toEqual(["lone-change"]);
  });

  it("broadcasts changeOrder on subscribe after a write", async () => {
    const store2 = createOpenSpecGroupStore({ debounceMs: 1 });
    try {
      const seen: Array<Record<string, string[]>> = [];
      store2.subscribe((_cwd, payload) => seen.push(payload.changeOrder));
      await store2.setChangeOrder(cwd, "ui", ["a-change"]);
      await new Promise((r) => setTimeout(r, 10));
      expect(seen.at(-1)?.["ui"]).toEqual(["a-change"]);
    } finally {
      store2.dispose();
    }
  });
});
