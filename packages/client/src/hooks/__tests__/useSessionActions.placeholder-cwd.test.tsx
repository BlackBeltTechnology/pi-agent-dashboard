/**
 * Regression suite for change: add-worktree-spawn-placeholder-card.
 *
 * Pin: `handleSpawnSession(cwd, attachProposal?, opts?)` honours
 * `opts.placeholderCwd` so the pending-spawn entry + spawning-set + timeout
 * key on the PARENT group cwd for worktree spawns, and guards against a
 * double-add / double-timeout when `onSpawnStart` already armed the group.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionActions } from "../useSessionActions.js";

function setup() {
  const spawningSet = new Set<string>();
  const setSpawningCwds = vi.fn((updater: any) => {
    const next = typeof updater === "function" ? updater(spawningSet) : updater;
    spawningSet.clear();
    for (const v of next) spawningSet.add(v);
  });
  const spawnTimeoutsRef = { current: new Map<string, ReturnType<typeof setTimeout>>() };
  const pendingSpawnsRef = {
    current: new Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>(),
  };
  const send = vi.fn();
  const clearSpawningCwd = vi.fn();

  const deps: any = {
    selectedId: undefined,
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions: new Map(),
    setSessions: vi.fn(),
    setSessionStates: vi.fn(),
    setSpawningCwds,
    setTerminals: vi.fn(),
    clearSpawningCwd,
    spawnTimeoutsRef,
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef,
  };
  const { result } = renderHook(() => useSessionActions(deps));
  return { actions: result.current, spawningSet, spawnTimeoutsRef, pendingSpawnsRef, send };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("useSessionActions — handleSpawnSession placeholderCwd", () => {
  it("stores placeholderCwd on the pending entry and keys the spawning set on it", () => {
    const { actions, spawningSet, pendingSpawnsRef, send } = setup();
    actions.handleSpawnSession("/repo/.worktrees/feat-x", undefined, { placeholderCwd: "/repo" });

    // Spawning set keyed on the parent group cwd, not the worktree path.
    expect(spawningSet.has("/repo")).toBe(true);
    expect(spawningSet.has("/repo/.worktrees/feat-x")).toBe(false);

    const entry = [...pendingSpawnsRef.current.values()][0];
    expect(entry.cwd).toBe("/repo/.worktrees/feat-x");
    expect(entry.placeholderCwd).toBe("/repo");

    // The wire message still carries the real spawn cwd (worktree path).
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "spawn_session",
      cwd: "/repo/.worktrees/feat-x",
    }));
  });

  it("defaults placeholderCwd to cwd for a normal spawn", () => {
    const { actions, spawningSet, pendingSpawnsRef } = setup();
    actions.handleSpawnSession("/repo");
    expect(spawningSet.has("/repo")).toBe(true);
    const entry = [...pendingSpawnsRef.current.values()][0];
    expect(entry.placeholderCwd).toBe("/repo");
  });

  it("does not double-arm a timeout when the group cwd timer already exists (onSpawnStart path)", () => {
    const { actions, spawnTimeoutsRef } = setup();
    // Simulate onSpawnStart having already armed a timer for the parent group.
    const existing = setTimeout(() => {}, 30_000);
    spawnTimeoutsRef.current.set("/repo", existing);

    actions.handleSpawnSession("/repo/.worktrees/feat-x", undefined, { placeholderCwd: "/repo" });

    // Still exactly one timer for the group cwd; the original was not replaced.
    expect(spawnTimeoutsRef.current.size).toBe(1);
    expect(spawnTimeoutsRef.current.get("/repo")).toBe(existing);
  });
});
