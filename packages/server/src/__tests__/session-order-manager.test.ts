import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferencesStore } from "../preferences-store.js";
import { createSessionOrderManager } from "../session-order-manager.js";

function createMockPreferencesStore(initialOrder: Record<string, string[]> = {}): PreferencesStore {
  let order = { ...initialOrder };
  return {
    getSessionOrder: vi.fn(() => order),
    setSessionOrder: vi.fn((o: Record<string, string[]>) => { order = o; }),
    getPinnedDirectories: vi.fn(() => []),
    setPinnedDirectories: vi.fn(),
    pinDirectory: vi.fn(),
    unpinDirectory: vi.fn(),
    reorderPinnedDirs: vi.fn(),
    getFavoriteModels: vi.fn(() => []),
    setFavoriteModels: vi.fn(),
    addFavoriteModel: vi.fn(),
    removeFavoriteModel: vi.fn(),
    getWorkspaces: vi.fn(() => []),
    createWorkspace: vi.fn(() => null),
    renameWorkspace: vi.fn(() => false),
    deleteWorkspace: vi.fn(() => false),
    setWorkspaceCollapsed: vi.fn(() => false),
    addFolderToWorkspace: vi.fn(() => false),
    removeFolderFromWorkspace: vi.fn(() => false),
    reorderWorkspaceFolders: vi.fn(() => false),
    reorderWorkspaces: vi.fn(() => false),
    flush: vi.fn(),
    getDisplayPrefs: vi.fn(() => undefined),
    getOpenSpecUpdateSignature: vi.fn(() => undefined),
    getAutoInitWorktreeOnSpawn: vi.fn(() => false),
    getAutoNameSessions: vi.fn(() => true),
    setAutoNameSessions: vi.fn(),
    getLiveServers: vi.fn(() => []),
    setLiveServers: vi.fn(),
    setAutoInitWorktreeOnSpawn: vi.fn(),
    setOpenSpecUpdateSignature: vi.fn(),
    setDisplayPrefs: vi.fn((p) => p as any),
    dispose: vi.fn(),
  };
}

describe("SessionOrderManager", () => {
  let stateStore: PreferencesStore;

  beforeEach(() => {
    stateStore = createMockPreferencesStore();
  });

  describe("insert", () => {
    it("prepends session to empty order", () => {
      const mgr = createSessionOrderManager(stateStore);
      mgr.insert("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1"]);
    });

    it("prepends session to existing order", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.insert("/project", "s3");
      expect(mgr.getOrder("/project")).toEqual(["s3", "s1", "s2"]);
    });

    it("inserts after parent when afterSessionId provided", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s3"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.insert("/project", "s2", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s2", "s3"]);
    });

    it("prepends when afterSessionId not found in order", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.insert("/project", "s3", "nonexistent");
      expect(mgr.getOrder("/project")).toEqual(["s3", "s1", "s2"]);
    });

    it("does not duplicate if session already in order", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.insert("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s2"]);
    });

    it("persists after insert", () => {
      const mgr = createSessionOrderManager(stateStore);
      mgr.insert("/project", "s1");
      expect(stateStore.setSessionOrder).toHaveBeenCalled();
    });
  });

  describe("reorder", () => {
    it("replaces order for a cwd", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2", "s3"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.reorder("/project", ["s3", "s1", "s2"]);
      expect(mgr.getOrder("/project")).toEqual(["s3", "s1", "s2"]);
    });

    it("persists after reorder", () => {
      const mgr = createSessionOrderManager(stateStore);
      mgr.reorder("/project", ["s1", "s2"]);
      expect(stateStore.setSessionOrder).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("removes session from order", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2", "s3"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.remove("/project", "s2");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s3"]);
    });

    it("no-op when session not in order", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.remove("/project", "s99");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s2"]);
    });

    it("removes empty cwd entry", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.remove("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual([]);
    });
  });

  describe("getOrder with validIds filtering", () => {
    it("filters out stale IDs", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2", "s3"] });
      const mgr = createSessionOrderManager(stateStore);
      const validIds = new Set(["s1", "s3"]);
      expect(mgr.getOrder("/project", validIds)).toEqual(["s1", "s3"]);
    });

    it("returns empty for unknown cwd", () => {
      const mgr = createSessionOrderManager(stateStore);
      expect(mgr.getOrder("/unknown")).toEqual([]);
    });

    it("returns all if no validIds filter", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      expect(mgr.getOrder("/project")).toEqual(["s1", "s2"]);
    });
  });

  describe("rekey", () => {
    it("moves id from old key to front of new key", () => {
      stateStore = createMockPreferencesStore({ "/repo/.worktrees/x": ["s1"], "/repo": ["s0"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/repo/.worktrees/x", "/repo", "s1", { toFront: true });
      expect(mgr.getOrder("/repo")).toEqual(["s1", "s0"]);
    });

    it("prunes the old key entry when it becomes empty", () => {
      stateStore = createMockPreferencesStore({ "/repo/.worktrees/x": ["s1"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/repo/.worktrees/x", "/repo", "s1", { toFront: true });
      expect(mgr.getAllOrders()).not.toHaveProperty("/repo/.worktrees/x");
      expect(mgr.getOrder("/repo")).toEqual(["s1"]);
    });

    it("keeps remaining ids under old key when not empty", () => {
      stateStore = createMockPreferencesStore({ "/repo/.worktrees/x": ["s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/repo/.worktrees/x", "/repo", "s1", { toFront: true });
      expect(mgr.getOrder("/repo/.worktrees/x")).toEqual(["s2"]);
      expect(mgr.getOrder("/repo")).toEqual(["s1"]);
    });

    it("is a no-op when oldKey === newKey", () => {
      stateStore = createMockPreferencesStore({ "/repo": ["s0", "s1"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/repo", "/repo", "s1", { toFront: true });
      expect(mgr.getOrder("/repo")).toEqual(["s0", "s1"]);
      expect(stateStore.setSessionOrder).not.toHaveBeenCalled();
    });

    it("dedupes when id already present under new key", () => {
      stateStore = createMockPreferencesStore({ "/repo/.worktrees/x": ["s1"], "/repo": ["s1", "s0"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/repo/.worktrees/x", "/repo", "s1", { toFront: true });
      expect(mgr.getOrder("/repo")).toEqual(["s1", "s0"]);
    });

    it("appends to new key when toFront not set", () => {
      stateStore = createMockPreferencesStore({ "/old": ["s1"], "/repo": ["s0"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/old", "/repo", "s1");
      expect(mgr.getOrder("/repo")).toEqual(["s0", "s1"]);
    });

    it("persists after rekey", () => {
      stateStore = createMockPreferencesStore({ "/old": ["s1"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.rekey("/old", "/repo", "s1", { toFront: true });
      expect(stateStore.setSessionOrder).toHaveBeenCalled();
    });
  });

  describe("getAllOrders", () => {
    it("returns all cwd orders", () => {
      stateStore = createMockPreferencesStore({ "/a": ["s1"], "/b": ["s2", "s3"] });
      const mgr = createSessionOrderManager(stateStore);
      const orders = mgr.getAllOrders();
      expect(orders).toEqual({ "/a": ["s1"], "/b": ["s2", "s3"] });
    });
  });

  describe("moveToFront", () => {
    it("prepends id when absent (creates entry for new cwd)", () => {
      const mgr = createSessionOrderManager(stateStore);
      mgr.moveToFront("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1"]);
    });

    it("prepends id when absent from existing order", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s0", "s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.moveToFront("/project", "s9");
      expect(mgr.getOrder("/project")).toEqual(["s9", "s0", "s1", "s2"]);
    });

    it("moves id from non-front position to index 0", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s0", "s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.moveToFront("/project", "s2");
      expect(mgr.getOrder("/project")).toEqual(["s2", "s0", "s1"]);
    });

    it("is idempotent: id already at front stays at index 0", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s0", "s1", "s2"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.moveToFront("/project", "s0");
      expect(mgr.getOrder("/project")).toEqual(["s0", "s1", "s2"]);
    });

    it("persists after moveToFront", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s0", "s1"] });
      const mgr = createSessionOrderManager(stateStore);
      mgr.moveToFront("/project", "s1");
      expect(stateStore.setSessionOrder).toHaveBeenCalled();
    });

    it("end → resume → end → resume cycle keeps id at index 0", () => {
      stateStore = createMockPreferencesStore({ "/project": ["s0", "s1"] });
      const mgr = createSessionOrderManager(stateStore);
      // First resume cycle: id is in the order list (drag-to-resume case)
      mgr.moveToFront("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s0"]);
      // End: alive→ended branch removes the id
      mgr.remove("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s0"]);
      // Second resume: moveToFront re-prepends
      mgr.moveToFront("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s0"]);
      // End again
      mgr.remove("/project", "s1");
      // Third resume
      mgr.moveToFront("/project", "s1");
      expect(mgr.getOrder("/project")).toEqual(["s1", "s0"]);
    });
  });
});
