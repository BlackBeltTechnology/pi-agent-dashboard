/**
 * Integration tests for session ordering flows.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSessionOrderManager } from "../session-order-manager.js";
import { createPendingForkRegistry } from "../pending-fork-registry.js";
import type { PreferencesStore } from "../preferences-store.js";

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
    flush: vi.fn(),
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

  // ── Worktree groupCwd ordering ────────────────────────────────────
  // See change: fix-worktree-placeholder-replacement.

  it("worktree session prepended to groupCwd order", () => {
    const orderMgr = createSessionOrderManager(stateStore);

    // Main repo sessions
    orderMgr.insert("/repo", "s1");
    orderMgr.insert("/repo", "s2"); // ["s2", "s1"]

    // Worktree session registers — get groupCwd from the session
    const groupCwd = "/repo";
    const sessionId = "wt-1";
    orderMgr.insert(groupCwd, sessionId);
    orderMgr.moveToFront(groupCwd, sessionId);

    expect(orderMgr.getOrder(groupCwd)).toEqual(["wt-1", "s2", "s1"]);
  });

  it("worktree session does not pollute worktree cwd order", () => {
    const orderMgr = createSessionOrderManager(stateStore);

    // Main repo sessions
    orderMgr.insert("/repo", "s1");

    // Worktree session registers — its own cwd is the worktree path
    const worktreeCwd = "/repo/.pi/worktrees/feature-x-123/";
    const groupCwd = "/repo";

    // Only insert into groupCwd
    orderMgr.insert(groupCwd, "wt-1");
    orderMgr.moveToFront(groupCwd, "wt-1");

    // Worktree cwd order should be empty (no insertion there)
    expect(orderMgr.getOrder(worktreeCwd)).toEqual([]);
    // Group cwd order should have the worktree session
    expect(orderMgr.getOrder(groupCwd)).toEqual(["wt-1", "s1"]);
  });

  it("multiple worktree sessions stack correctly in groupCwd order", () => {
    const orderMgr = createSessionOrderManager(stateStore);
    const groupCwd = "/repo";

    // Spawn A
    orderMgr.insert(groupCwd, "wt-a");
    orderMgr.moveToFront(groupCwd, "wt-a");
    expect(orderMgr.getOrder(groupCwd)).toEqual(["wt-a"]);

    // Spawn B
    orderMgr.insert(groupCwd, "wt-b");
    orderMgr.moveToFront(groupCwd, "wt-b");
    expect(orderMgr.getOrder(groupCwd)).toEqual(["wt-b", "wt-a"]);

    // Spawn C
    orderMgr.insert(groupCwd, "wt-c");
    orderMgr.moveToFront(groupCwd, "wt-c");
    expect(orderMgr.getOrder(groupCwd)).toEqual(["wt-c", "wt-b", "wt-a"]);
  });
});
