/**
 * `PreferencesStore.moveFolderToWorkspace` — the validate-before-mutate
 * contract, index clamping, and single-membership.
 * Covers test-plan #E1-#E4, #E6-#E9, #E19, #E20.
 * See change: drag-folders-across-workspaces.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesStore } from "../persistence/preferences-store.js";

vi.mock("../resolve-path.js", () => ({
  safeRealpathSync: (p: string) => p,
}));

// Host-platform absolute paths — raw POSIX strings normalize to `B:\a` on
// Windows and would break the assertions.
const A_PATH = path.resolve(os.tmpdir(), "mv-a");
const X_PATH = path.resolve(os.tmpdir(), "mv-x");
const Y_PATH = path.resolve(os.tmpdir(), "mv-y");
const Z_PATH = path.resolve(os.tmpdir(), "mv-z");

describe("preferences-store moveFolderToWorkspace", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pref-move-test-"));
    filePath = path.join(tmpDir, "preferences.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Store with ws A owning `/a` and ws B owning `[x,y,z]`. */
  function seed() {
    const store = createPreferencesStore(filePath);
    const a = store.createWorkspace("a")!;
    const b = store.createWorkspace("b")!;
    store.addFolderToWorkspace(a.id, A_PATH);
    for (const p of [X_PATH, Y_PATH, Z_PATH]) store.addFolderToWorkspace(b.id, p);
    const folders = (id: string) => store.getWorkspaces().find((w) => w.id === id)!.folders;
    return { store, a, b, folders };
  }

  // #E1 — a negative index must NOT make splice count from the end.
  it("clamps a negative index to position 0", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, b.id, -1)).toBe(true);
    expect(folders(b.id)).toEqual([A_PATH, X_PATH, Y_PATH, Z_PATH]);
    store.dispose();
  });

  // #E2
  it("inserts at index 0", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, b.id, 0)).toBe(true);
    expect(folders(b.id)).toEqual([A_PATH, X_PATH, Y_PATH, Z_PATH]);
    store.dispose();
  });

  // #E3
  it("inserts at the end index", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, b.id, 3)).toBe(true);
    expect(folders(b.id)).toEqual([X_PATH, Y_PATH, Z_PATH, A_PATH]);
    store.dispose();
  });

  // #E4
  it("clamps an out-of-range index to the end", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, b.id, 4)).toBe(true);
    expect(folders(b.id)).toEqual([X_PATH, Y_PATH, Z_PATH, A_PATH]);
    store.dispose();
  });

  // #E6
  it("appends when index is omitted", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, b.id)).toBe(true);
    expect(folders(b.id)).toEqual([X_PATH, Y_PATH, Z_PATH, A_PATH]);
    store.dispose();
  });

  // #E7 — validate-before-mutate: an unknown target must not detach.
  it("rejects an unknown target without detaching the folder", () => {
    const { store, a, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, "nope")).toBe(false);
    expect(folders(a.id)).toEqual([A_PATH]);
    store.dispose();
  });

  // #E8
  it("rejects a same-workspace move and leaves the order untouched", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(Y_PATH, b.id, 0)).toBe(false);
    expect(folders(b.id)).toEqual([X_PATH, Y_PATH, Z_PATH]);
    store.dispose();
  });

  // #E9 — ejecting a folder that is in no workspace is a no-op.
  it("rejects an eject of a folder that belongs to no workspace", () => {
    const store = createPreferencesStore(filePath);
    store.createWorkspace("a");
    expect(store.moveFolderToWorkspace(A_PATH, null)).toBe(false);
    expect(store.getPinnedDirectories()).toEqual([]);
    store.dispose();
  });

  it("ejects a member folder from every workspace", () => {
    const { store, a, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, null)).toBe(true);
    expect(folders(a.id)).toEqual([]);
    store.dispose();
  });

  // #E19 — single membership across the move.
  it("moves the folder into the target and out of the source", () => {
    const { store, a, b, folders } = seed();
    expect(store.moveFolderToWorkspace(A_PATH, b.id, 1)).toBe(true);
    expect(folders(a.id)).toEqual([]);
    expect(folders(b.id)).toEqual([X_PATH, A_PATH, Y_PATH, Z_PATH]);
    store.dispose();
  });

  // #E20 — a trailing-separator variant canonicalizes to one entry.
  it("canonicalizes the path so a trailing separator does not duplicate", () => {
    const { store, b, folders } = seed();
    expect(store.moveFolderToWorkspace(`${A_PATH}${path.sep}`, b.id)).toBe(true);
    expect(folders(b.id)).toEqual([X_PATH, Y_PATH, Z_PATH, A_PATH]);
    // Already a member under the canonical form → rejected, no duplicate.
    expect(store.moveFolderToWorkspace(A_PATH, b.id)).toBe(false);
    expect(folders(b.id).filter((p) => p === A_PATH)).toHaveLength(1);
    store.dispose();
  });
});
