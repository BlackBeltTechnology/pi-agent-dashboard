/**
 * Host workspace seam (change: add-chat-gateway-team-controls, section 1).
 *
 * Covers the spec `plugin-workspace-seam`: read-only accessor, defensive copy,
 * every-mutator notification, unsubscribe, throwing-subscriber isolation, and
 * the completeness guard that makes a newly added unwired mutator detectable.
 *
 * Scenarios: E26 (defensive copy), E27 (empty state), E28 (every mutator
 * notifies), E29 (completeness guard), 10f.5 (unsubscribe), X22 (throwing
 * subscriber).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreferencesStore,
  discoverWorkspaceMutators,
  WORKSPACE_MUTATOR_NAMES,
} from "../persistence/preferences-store.js";

vi.mock("../resolve-path.js", () => ({
  safeRealpathSync: vi.fn((p: string) => p),
}));

const FOLDER = path.resolve(os.tmpdir(), "ws-seam-folder");
const FOLDER2 = path.resolve(os.tmpdir(), "ws-seam-folder-2");

describe("preferences-store workspace seam", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pref-ws-seam-"));
    filePath = path.join(tmpDir, "preferences.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E27: returns an empty collection when no workspaces are configured", () => {
    const store = createPreferencesStore(filePath);
    expect(store.getWorkspaces()).toEqual([]);
    store.dispose();
  });

  it("E26: accessor returns a defensive copy (array + nested folders)", () => {
    const store = createPreferencesStore(filePath);
    const created = store.createWorkspace("Team");
    expect(created).not.toBeNull();
    store.addFolderToWorkspace(created!.id, FOLDER);

    const first = store.getWorkspaces();
    first[0].name = "mutated";
    first[0].folders.push("/evil");
    first.pop();

    const reread = store.getWorkspaces();
    expect(reread).toHaveLength(1);
    expect(reread[0].name).toBe("Team");
    expect(reread[0].folders).toEqual([FOLDER]);
    store.dispose();
  });

  it("E28: every workspace mutator notifies subscribers (9 mutators → 9 notifications)", () => {
    const store = createPreferencesStore(filePath);
    // Seed before subscribing so each of the nine mutators is invoked exactly
    // once under the subscriber.
    const idA = store.createWorkspace("A")!.id;
    const idB = store.createWorkspace("B")!.id;
    const idC = store.createWorkspace("C")!.id;

    let count = 0;
    const unsub = store.onWorkspacesChanged(() => {
      count += 1;
    });

    const idD = store.createWorkspace("D")!.id;
    store.renameWorkspace(idA, "A-renamed");
    store.deleteWorkspace(idC);
    store.setWorkspaceCollapsed(idA, true);
    store.addFolderToWorkspace(idA, FOLDER);
    store.removeFolderFromWorkspace(idA, FOLDER);
    store.moveFolderToWorkspace(FOLDER2, idA, 0);
    store.reorderWorkspaceFolders(idA, [FOLDER2]);
    store.reorderWorkspaces([idD, idB, idA]);

    expect(count).toBe(9);
    unsub();
    store.dispose();
  });

  it("E29: the completeness guard detects an unwired mutator", () => {
    // The wired contract and the discovered store surface must agree.
    const store = createPreferencesStore(filePath);
    const discovered = discoverWorkspaceMutators(Object.keys(store));
    expect(discovered.sort()).toEqual([...WORKSPACE_MUTATOR_NAMES].sort());

    // A mutator present on the store but absent from the wired list is a defect.
    expect(discoverWorkspaceMutators([...Object.keys(store), "archiveWorkspace"])).toContain(
      "archiveWorkspace",
    );
    expect(WORKSPACE_MUTATOR_NAMES).not.toContain("archiveWorkspace");
    store.dispose();
  });

  it("10f.5: an unsubscribed handler is not invoked", () => {
    const store = createPreferencesStore(filePath);
    let count = 0;
    const unsub = store.onWorkspacesChanged(() => {
      count += 1;
    });
    unsub();
    store.createWorkspace("later");
    expect(count).toBe(0);
    store.dispose();
  });

  it("X22: a throwing subscriber does not block others or fail the mutation", () => {
    const store = createPreferencesStore(filePath);
    let secondCalled = 0;
    store.onWorkspacesChanged(() => {
      throw new Error("boom");
    });
    store.onWorkspacesChanged(() => {
      secondCalled += 1;
    });

    expect(() => store.createWorkspace("resilient")).not.toThrow();
    expect(secondCalled).toBe(1);
    expect(store.getWorkspaces()).toHaveLength(1);
    store.dispose();
  });
});
