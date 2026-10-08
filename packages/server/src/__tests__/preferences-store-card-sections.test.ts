import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesStore } from "../persistence/preferences-store.js";

vi.mock("../resolve-path.js", () => ({
  safeRealpathSync: vi.fn((p: string) => p),
}));

// Host-platform absolute paths (see preferences-store.test.ts rationale).
const A_PATH = path.resolve(os.tmpdir(), "cs-a");
const B_PATH = path.resolve(os.tmpdir(), "cs-b");

describe("preferences-store cardSections (configurable-session-card-sections)", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-store-test-"));
    filePath = path.join(tmpDir, "preferences.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("legacy file without the field loads as {}", () => {
    fs.writeFileSync(filePath, JSON.stringify({ pinnedDirectories: [], sessionOrder: {} }));
    const store = createPreferencesStore(filePath);
    expect(store.getCardSections()).toEqual({});
    store.dispose();
  });

  it("sets a global default and a folder override; returns true only on mutation", () => {
    const store = createPreferencesStore(filePath);
    expect(store.setCardSectionVisibility(undefined, "flows", false)).toBe(true);
    expect(store.setCardSectionVisibility(undefined, "flows", false)).toBe(false);
    expect(store.setCardSectionVisibility(A_PATH, "git", false)).toBe(true);
    expect(store.setCardSectionVisibility(`${A_PATH}/`, "git", false)).toBe(false);
    expect(store.getCardSections()).toEqual({ global: { flows: false }, folders: { [A_PATH]: { git: false } } });
    store.dispose();
  });

  it("null deletes the key sparsely and removes an emptied folder", () => {
    const store = createPreferencesStore(filePath);
    store.setCardSectionVisibility(A_PATH, "tags", false);
    store.setCardSectionVisibility(A_PATH, "git", true);
    expect(store.setCardSectionVisibility(A_PATH, "tags", null)).toBe(true);
    expect(store.getCardSections().folders).toEqual({ [A_PATH]: { git: true } });
    expect(store.setCardSectionVisibility(A_PATH, "git", null)).toBe(true);
    expect(store.getCardSections().folders?.[A_PATH]).toBeUndefined();
    expect(store.setCardSectionVisibility(A_PATH, "git", null)).toBe(false);
    expect(store.setCardSectionVisibility(undefined, "git", null)).toBe(false);
    store.dispose();
  });

  it("resetFolderCardSections drops the folder entry", () => {
    const store = createPreferencesStore(filePath);
    store.setCardSectionVisibility(A_PATH, "git", false);
    store.setCardSectionVisibility(B_PATH, "git", false);
    expect(store.resetFolderCardSections(A_PATH)).toBe(true);
    expect(store.resetFolderCardSections(A_PATH)).toBe(false);
    expect(Object.keys(store.getCardSections().folders ?? {})).toEqual([B_PATH]);
    store.dispose();
  });

  it("rejects invalid ids, values and paths without mutating", () => {
    const store = createPreferencesStore(filePath);
    expect(store.setCardSectionVisibility(A_PATH, "../x", false)).toBe(false);
    expect(store.setCardSectionVisibility(A_PATH, "__proto__", false)).toBe(false);
    expect(store.setCardSectionVisibility("", "git", false)).toBe(false);
    expect(store.setCardSectionVisibility("__proto__", "git", false)).toBe(false);
    expect(store.setCardSectionVisibility("relative/dir", "git", false)).toBe(false);
    expect(store.setCardSectionVisibility(A_PATH, "git", "no" as unknown as boolean)).toBe(false);
    expect(store.resetFolderCardSections("")).toBe(false);
    expect(store.getCardSections()).toEqual({});
    expect(({} as Record<string, unknown>).git).toBeUndefined();
    store.dispose();
  });

  it("enforces the folder cap and per-map key cap", () => {
    const folders: Record<string, Record<string, boolean>> = {};
    for (let i = 0; i < 1000; i++) folders[path.join(tmpDir, `f-${i}`)] = { git: false };
    fs.writeFileSync(filePath, JSON.stringify({ cardSections: { folders } }));
    const store = createPreferencesStore(filePath);
    expect(Object.keys(store.getCardSections().folders ?? {})).toHaveLength(1000);
    expect(store.setCardSectionVisibility(A_PATH, "git", false)).toBe(false);
    // Existing folder still mutable at the folder cap.
    expect(store.setCardSectionVisibility(path.join(tmpDir, "f-0"), "tags", false)).toBe(true);
    for (let i = 0; i < 64; i++) {
      if (i < 63) expect(store.setCardSectionVisibility(undefined, `s-${i}`, false)).toBe(true);
    }
    expect(store.setCardSectionVisibility(undefined, "s-63", false)).toBe(true);
    expect(store.setCardSectionVisibility(undefined, "s-64", false)).toBe(false);
    // Overwriting an existing key at the cap is still allowed.
    expect(store.setCardSectionVisibility(undefined, "s-0", true)).toBe(true);
    store.dispose();
  });

  it("preserves unknown valid ids and sanitizes corrupt entries on load", () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        pinnedDirectories: [A_PATH],
        cardSections: {
          global: { "future-plugin": false, "BAD ID": false, git: "x" },
          folders: { [`${A_PATH}/`]: { "future-plugin": true }, relative: { git: false }, [B_PATH]: {} },
        },
      }),
    );
    const store = createPreferencesStore(filePath);
    expect(store.getCardSections()).toEqual({
      global: { "future-plugin": false },
      folders: { [A_PATH]: { "future-plugin": true } },
    });
    store.setCardSectionVisibility(A_PATH, "git", false);
    expect(store.getCardSections().folders?.[A_PATH]).toEqual({ "future-plugin": true, git: false });
    expect(store.getPinnedDirectories()).toEqual([A_PATH]);
    store.dispose();
  });

  it("a corrupt (non-object) field falls back to {} without failing the load", () => {
    fs.writeFileSync(filePath, JSON.stringify({ pinnedDirectories: [A_PATH], cardSections: "nope" }));
    const store = createPreferencesStore(filePath);
    expect(store.getCardSections()).toEqual({});
    expect(store.getPinnedDirectories()).toEqual([A_PATH]);
    store.dispose();
  });

  it("survives the debounced-write restart round-trip", () => {
    const store = createPreferencesStore(filePath);
    store.setCardSectionVisibility(A_PATH, "process", false);
    store.setCardSectionVisibility(undefined, "flows", false);
    store.flush();
    store.dispose();
    const reloaded = createPreferencesStore(filePath);
    expect(reloaded.getCardSections()).toEqual({
      global: { flows: false },
      folders: { [A_PATH]: { process: false } },
    });
    reloaded.dispose();
  });

  it("getCardSections returns a copy (callers cannot mutate store state)", () => {
    const store = createPreferencesStore(filePath);
    store.setCardSectionVisibility(A_PATH, "git", false);
    const snap = store.getCardSections();
    snap.folders![A_PATH].git = true;
    expect(store.getCardSections().folders?.[A_PATH]).toEqual({ git: false });
    store.dispose();
  });

  describe("focus state + expandedFolders (add-focus-mode-and-card-block-toggles)", () => {
    it("corrupt focus state on load -> focus off, empty profile, no proto key, other prefs intact", () => {
      fs.writeFileSync(
        filePath,
        `{"pinnedDirectories":[],"cardSections":{"global":{"git":false},"focus":{"enabled":"x","profile":{"sections":{"__proto__":true,"git":"no"}}}}}`,
      );
      const store = createPreferencesStore(filePath);
      const snap = store.getCardSections();
      expect(snap.global).toEqual({ git: false });
      expect(snap.focus?.enabled).toBeFalsy();
      expect(snap.focus?.profile?.sections ?? {}).toEqual({});
      expect(Object.hasOwn(snap.focus?.profile?.sections ?? {}, "__proto__")).toBe(false);
      store.dispose();
    });

    it("setFocusEnabled / setFocusProfile mutate only on change and round-trip a restart", () => {
      const store = createPreferencesStore(filePath);
      expect(store.setFocusEnabled(true)).toBe(true);
      expect(store.setFocusEnabled(true)).toBe(false);
      expect(store.setFocusProfile({ sections: { git: false }, folderListMode: "classic" })).toBe(true);
      expect(store.setFocusProfile({ sections: { git: false }, folderListMode: "classic" })).toBe(false);
      expect(store.setExpandedFolder(A_PATH, true)).toBe(true);
      store.flush();
      store.dispose();
      const re = createPreferencesStore(filePath);
      expect(re.getCardSections().focus).toEqual({
        enabled: true,
        profile: { sections: { git: false }, folderListMode: "classic" },
      });
      expect(re.getExpandedFolders()).toEqual([A_PATH]);
      expect(re.setFocusProfile(null)).toBe(true);
      expect(re.getCardSections().focus).toEqual({ enabled: true });
      re.dispose();
    });

    it("rejects an invalid or over-cap profile without mutation", () => {
      const store = createPreferencesStore(filePath);
      const many = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`s${i}`, true]));
      expect(store.setFocusProfile({ sections: many })).toBe(false);
      expect(store.setFocusProfile({ sections: { "../x": true } })).toBe(false);
      expect(store.setFocusProfile(5 as never)).toBe(false);
      expect(store.setFocusProfile([] as never)).toBe(false);
      expect(store.getCardSections().focus).toBeUndefined();
      store.dispose();
    });

    it("pin clears collapsed and collapse clears pin; never pruned", () => {
      const store = createPreferencesStore(filePath);
      store.setFolderCollapsed(A_PATH, true);
      expect(store.setExpandedFolder(A_PATH, true)).toBe(true);
      expect(store.getCollapsedFolders()).toEqual([]);
      expect(store.getExpandedFolders()).toEqual([A_PATH]);
      expect(store.setFolderCollapsed(A_PATH, true)).toBe(true);
      expect(store.getExpandedFolders()).toEqual([]);
      expect(store.getCollapsedFolders()).toEqual([A_PATH]);
      expect(store.setExpandedFolder(`${B_PATH}/`, true)).toBe(true);
      expect(store.setExpandedFolder(B_PATH, true)).toBe(false);
      expect(store.getExpandedFolders()).toEqual([B_PATH]);
      expect(store.setExpandedFolder(B_PATH, false)).toBe(true);
      store.dispose();
    });
  });
});
