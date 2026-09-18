import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getActiveOnly,
  setActiveOnly,
  readLegacyCollapsedGroups,
  writeLegacyCollapsedGroups,
  clearLegacyCollapsedGroups,
  decideCollapsedFoldersMigration,
  COLLAPSED_MIGRATION_MAX_ATTEMPTS,
  getIncludeArchive,
  setIncludeArchive,
  removeLegacyHiddenSessions,
} from "../session/session-filter-storage.js";

// Node 25's built-in localStorage overrides jsdom's and lacks standard methods.
// Mock window.localStorage with a simple Map-based implementation.
const store = new Map<string, string>();
const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
} as unknown as Storage;

Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });

describe("session-filter-storage", () => {
  beforeEach(() => {
    store.clear();
  });

  describe("removeLegacyHiddenSessions", () => {
    it("should remove legacy hiddenSessions key", () => {
      store.set("dashboard:hiddenSessions", '["a","b"]');
      removeLegacyHiddenSessions();
      expect(store.has("dashboard:hiddenSessions")).toBe(false);
    });

    it("should not throw when key does not exist", () => {
      expect(() => removeLegacyHiddenSessions()).not.toThrow();
    });
  });

  describe("getActiveOnly / setActiveOnly", () => {
    it("should return true when nothing stored (default ON)", () => {
      expect(getActiveOnly()).toBe(true);
    });

    it("should round-trip true", () => {
      setActiveOnly(true);
      expect(getActiveOnly()).toBe(true);
    });

    it("should round-trip false", () => {
      setActiveOnly(false);
      expect(getActiveOnly()).toBe(false);
    });
  });

  describe("collapsed-folders migration (persist-folder-collapse-server-side)", () => {
    const LEGACY_KEY = "dashboard:collapsedGroups";
    const linux = "linux" as NodeJS.Platform;

    it("X1: an unconfirmed legacy value is retained with the attempt counter advanced", () => {
      store.set(LEGACY_KEY, JSON.stringify(["/repo/a"]));
      const legacy = readLegacyCollapsedGroups();
      expect(legacy).not.toBeNull();
      const decision = decideCollapsedFoldersMigration({
        legacy: legacy!,
        knownServerKeys: new Set(),
        sentKeys: new Set(),
        platform: linux,
        countAttempt: true,
      });
      expect(decision.toSend).toEqual(["/repo/a"]);
      expect(decision.clearLegacy).toBe(false);
      expect(decision.nextRecord?.attempts).toBe(1);
      // The caller persists the advanced record; the key is RETAINED.
      writeLegacyCollapsedGroups(decision.nextRecord!);
      expect(readLegacyCollapsedGroups()?.attempts).toBe(1);
    });

    it("X2: sends nothing and clears immediately when the server already holds every key", () => {
      store.set(LEGACY_KEY, JSON.stringify(["/repo/a"]));
      const decision = decideCollapsedFoldersMigration({
        legacy: readLegacyCollapsedGroups()!,
        knownServerKeys: new Set(["/repo/a"]),
        sentKeys: new Set(),
        platform: linux,
        countAttempt: true,
      });
      expect(decision.toSend).toEqual([]);
      expect(decision.clearLegacy).toBe(true);
      expect(decision.backstopDropped).toBe(false);
    });

    it("X3: the 10th load drops the legacy key with no further send", () => {
      writeLegacyCollapsedGroups({ keys: ["/repo/a"], attempts: 9 });
      const decision = decideCollapsedFoldersMigration({
        legacy: readLegacyCollapsedGroups()!,
        knownServerKeys: new Set(),
        sentKeys: new Set(),
        platform: linux,
        countAttempt: true,
      });
      expect(decision.toSend).toEqual([]);
      expect(decision.clearLegacy).toBe(true);
      expect(decision.backstopDropped).toBe(true);
      clearLegacyCollapsedGroups();
      expect(readLegacyCollapsedGroups()).toBeNull();
    });

    it("X4: deduplicates separator spellings to one key and one message", () => {
      store.set(LEGACY_KEY, JSON.stringify(["/repo/a", "/repo/a/"]));
      const decision = decideCollapsedFoldersMigration({
        legacy: readLegacyCollapsedGroups()!,
        knownServerKeys: new Set(),
        sentKeys: new Set(),
        platform: linux,
        countAttempt: true,
      });
      expect(decision.toSend).toEqual(["/repo/a"]);
    });

    it("X5: unions into the server set — a server-only folder is preserved", () => {
      store.set(LEGACY_KEY, JSON.stringify(["/repo/a"]));
      const serverKeys = new Set(["/repo/other"]);
      const decision = decideCollapsedFoldersMigration({
        legacy: readLegacyCollapsedGroups()!,
        knownServerKeys: serverKeys,
        sentKeys: new Set(),
        platform: linux,
        countAttempt: true,
      });
      expect(decision.toSend).toEqual(["/repo/a"]);
      // The migration never proposes removing the server's own key.
      expect(decision.nextRecord?.keys).not.toContain("/repo/other");
    });

    it("X6: no legacy key is a no-op", () => {
      expect(readLegacyCollapsedGroups()).toBeNull();
    });

    it("does not re-send a key already sent this load", () => {
      const decision = decideCollapsedFoldersMigration({
        legacy: { keys: ["/repo/a", "/repo/b"], attempts: 1 },
        knownServerKeys: new Set(["/repo/a"]),
        sentKeys: new Set(["/repo/b"]),
        platform: linux,
        countAttempt: false,
      });
      expect(decision.toSend).toEqual([]);
      expect(decision.clearLegacy).toBe(false);
      expect(decision.nextRecord?.attempts).toBe(1);
    });

    it("reads the in-progress object shape and tolerates corrupt JSON", () => {
      expect(readLegacyCollapsedGroups()).toBeNull();
      store.set(LEGACY_KEY, "not-json");
      expect(readLegacyCollapsedGroups()).toBeNull();
      store.set(LEGACY_KEY, JSON.stringify({ keys: ["/a", 5, null], attempts: 2 }));
      expect(readLegacyCollapsedGroups()).toEqual({ keys: ["/a"], attempts: 2 });
    });

    it("exposes a 10-load backstop constant", () => {
      expect(COLLAPSED_MIGRATION_MAX_ATTEMPTS).toBe(10);
    });
  });
});

// #F13: the include-archive search chip persists in localStorage.
// See change: archive-sessions-lazy-load.
describe("getIncludeArchive / setIncludeArchive", () => {
  it("should default to false when nothing stored", () => {
    expect(getIncludeArchive()).toBe(false);
  });

  it("should round-trip true", () => {
    setIncludeArchive(true);
    expect(getIncludeArchive()).toBe(true);
  });

  it("should round-trip false", () => {
    setIncludeArchive(true);
    setIncludeArchive(false);
    expect(getIncludeArchive()).toBe(false);
  });

  it("should not throw when storage access fails", () => {
    const throwing = { ...mockStorage, getItem: () => { throw new Error("denied"); } };
    Object.defineProperty(window, "localStorage", { value: throwing, writable: true });
    expect(getIncludeArchive()).toBe(false);
    Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });
  });
});
