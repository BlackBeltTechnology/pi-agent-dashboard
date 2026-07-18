/**
 * Integration tests for session ordering flows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { createSessionOrderManager } from "../session/session-order-manager.js";

function createMockPreferencesStore(): PreferencesStore {
  let order: Record<string, string[]> = {};
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

describe("Session ordering integration", () => {
  let stateStore: PreferencesStore;

  beforeEach(() => {
    stateStore = createMockPreferencesStore();
  });

  it("new session prepends to order", () => {
    const orderMgr = createSessionOrderManager(stateStore);
    orderMgr.insert("/project", "s1");
    orderMgr.insert("/project", "s2");
    orderMgr.insert("/project", "s3");
    expect(orderMgr.getOrder("/project")).toEqual(["s3", "s2", "s1"]);
  });

  it("fork inserts after parent", () => {
    const orderMgr = createSessionOrderManager(stateStore);
    const forkRegistry = createPendingForkRegistry();

    // Setup: two sessions exist
    orderMgr.insert("/project", "s1");
    orderMgr.insert("/project", "s2"); // s2 is at front: ["s2", "s1"]

    // User forks s1
    forkRegistry.recordFork("/project", "s1");

    // New session registers — simulate server checking fork registry
    const forkParent = forkRegistry.consumeFork("/project");
    orderMgr.insert("/project", "s3", forkParent ?? undefined);

    // s3 should be after s1: ["s2", "s1", "s3"]
    expect(orderMgr.getOrder("/project")).toEqual(["s2", "s1", "s3"]);
  });

  it("reorder replaces order", () => {
    const orderMgr = createSessionOrderManager(stateStore);
    orderMgr.insert("/project", "s1");
    orderMgr.insert("/project", "s2");
    orderMgr.insert("/project", "s3"); // ["s3", "s2", "s1"]

    orderMgr.reorder("/project", ["s1", "s3", "s2"]);
    expect(orderMgr.getOrder("/project")).toEqual(["s1", "s3", "s2"]);
  });

  it("continue preserves position (no re-insert for existing ID)", () => {
    const orderMgr = createSessionOrderManager(stateStore);
    orderMgr.insert("/project", "s1");
    orderMgr.insert("/project", "s2"); // ["s2", "s1"]

    // s1 re-registers (continue) — insert is a no-op because ID already exists
    orderMgr.insert("/project", "s1");
    expect(orderMgr.getOrder("/project")).toEqual(["s2", "s1"]);
  });

  it("getOrder prunes stale IDs", () => {
    const orderMgr = createSessionOrderManager(stateStore);
    orderMgr.insert("/project", "s1");
    orderMgr.insert("/project", "s2");
    orderMgr.insert("/project", "s3"); // ["s3", "s2", "s1"]

    // s2 no longer exists
    const validIds = new Set(["s1", "s3"]);
    expect(orderMgr.getOrder("/project", validIds)).toEqual(["s3", "s1"]);
  });

  it("concurrent registrations in same cwd maintain correct order", () => {
    const orderMgr = createSessionOrderManager(stateStore);

    // Simulate rapid concurrent registrations (all synchronous in Node.js)
    orderMgr.insert("/project", "s1");
    orderMgr.insert("/project", "s2");
    orderMgr.insert("/project", "s3");
    orderMgr.insert("/project", "s4");
    orderMgr.insert("/project", "s5");

    // All should be in reverse order (most recent first)
    expect(orderMgr.getOrder("/project")).toEqual(["s5", "s4", "s3", "s2", "s1"]);
  });
});
