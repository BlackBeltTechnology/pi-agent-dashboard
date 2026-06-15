/**
 * Regression suite for change: fix-worktree-spawn-placeholder-and-ordering
 * (Defect A — client Tier 2.5 placeholder clear fallback).
 *
 * When `session_added` carries NO matching `spawnRequestId` AND the session's
 * own cwd is not in `spawningCwds` (always true for worktree spawns, whose
 * placeholder is keyed by the PARENT cwd), the handler scans pending spawns
 * for a `kind: "spawn"` entry whose tracked cwd equals the session cwd and
 * clears that entry's `placeholderCwd`. Without this, a worktree placeholder
 * orphans whenever Tier 1 (spawnRequestId) misses.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(id: string, cwd: string): DashboardSession {
  return { id, cwd, source: "tui", status: "active", startedAt: 1 } as DashboardSession;
}

function setup(
  pending: Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>,
  spawningCwds = new Set<string>(),
) {
  const clearSpawningCwd = vi.fn();
  const navigate = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(), setViewMessagesMap: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(),
    navigate,
    clearSpawningCwd,
    spawningCwdsRef: { current: spawningCwds },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: pending },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), clearSpawningCwd, navigate, pending };
}

describe("useMessageHandler — Tier 2.5 worktree fallback", () => {
  it("clears parent placeholder when no spawnRequestId matches (worktree spawn)", () => {
    const pending = new Map([
      ["rq-1", { cwd: "/repo/.worktrees/feat-x", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s", "/repo/.worktrees/feat-x"),
      // NO spawnRequestId.
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    expect(navigate).toHaveBeenCalledWith("/session/new-s");
    expect(pending.has("rq-1")).toBe(false);
  });

  it("does NOT run for a plain spawn already cleared by Tier 2 (cwd match)", () => {
    // Plain spawn: placeholderCwd === cwd, and session.cwd is in spawningCwds.
    const pending = new Map([
      ["rq-2", { cwd: "/repo", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd } = setup(pending, new Set(["/repo"]));

    dispatch({
      type: "session_added",
      session: makeSession("new-s2", "/repo"),
      // NO spawnRequestId → Tier 2 (spawningCwds) handles it.
    } as ServerToBrowserMessage);

    // Tier 2 cleared exactly once with the cwd; Tier 2.5 did not double-handle.
    expect(clearSpawningCwd).toHaveBeenCalledTimes(1);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    // Tier 2 does not consume the pending entry (only Tier 1 / 2.5 do).
    expect(pending.has("rq-2")).toBe(true);
  });

  it("ignores resume entries sharing the session cwd", () => {
    const pending = new Map([
      ["rq-3", { cwd: "/repo/.worktrees/feat-z", kind: "resume" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s3", "/repo/.worktrees/feat-z"),
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq-3")).toBe(true);
  });

  it("normalizes trailing slash when comparing cwds", () => {
    const pending = new Map([
      ["rq-4", { cwd: "/repo/.worktrees/feat-x/", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s4", "/repo/.worktrees/feat-x"),
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    expect(pending.has("rq-4")).toBe(false);
  });
});
