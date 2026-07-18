/**
 * Regression suite for change: add-worktree-spawn-placeholder-card.
 *
 * Pin: when a pending-spawn entry carries `placeholderCwd` (worktree spawn —
 * the parent repo group cwd, distinct from the worktree spawn `cwd`), the
 * placeholder clear keys on `placeholderCwd`, NOT the worktree path.
 *
 *  - session_added (requestId tier) → clearSpawningCwd(entry.placeholderCwd).
 *  - spawn_result failure (requestId match) → clearSpawningCwd(entry.placeholderCwd).
 *  - Normal spawn (no placeholderCwd) → clearSpawningCwd(entry.cwd) unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(id: string, cwd: string): DashboardSession {
  return {
    id,
    cwd,
    source: "tui",
    status: "active",
    startedAt: 1,
  } as DashboardSession;
}

function setup(pending: Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>) {
  const clearSpawningCwd = vi.fn();
  const navigate = vi.fn();
  const setters: any = {
    setSessions: vi.fn(),
    setSessionStates: vi.fn(),
    setSessionCommands: vi.fn(),
    setFileResults: vi.fn(),
    setOpenspecMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(),
    navigate,
    clearSpawningCwd,
    spawningCwdsRef: { current: new Set<string>() },
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

describe("useMessageHandler — placeholderCwd clearing", () => {
  it("session_added clears the PARENT cwd placeholder for a worktree spawn", () => {
    const pending = new Map([
      ["rq-1", { cwd: "/repo/.worktrees/feat-x", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s", "/repo/.worktrees/feat-x"),
      spawnRequestId: "rq-1",
    } as ServerToBrowserMessage);

    // Keyed on placeholderCwd (parent), NOT the worktree path.
    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    expect(clearSpawningCwd).not.toHaveBeenCalledWith("/repo/.worktrees/feat-x");
    expect(navigate).toHaveBeenCalledWith("/session/new-s");
    // Pending entry consumed.
    expect(pending.has("rq-1")).toBe(false);
  });

  it("session_added clears the spawn cwd for a normal spawn (no placeholderCwd)", () => {
    // Omit placeholderCwd so this exercises the `?? entry.cwd` fallback.
    const pending = new Map([
      ["rq-2", { cwd: "/repo", kind: "spawn" as const }],
    ]);
    const { dispatch, clearSpawningCwd } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("new-s2", "/repo"),
      spawnRequestId: "rq-2",
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
  });

  it("spawn_result failure clears the PARENT cwd placeholder using the matching entry", () => {
    const pending = new Map([
      ["rq-3", { cwd: "/repo/.worktrees/feat-y", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd } = setup(pending);

    dispatch({
      type: "spawn_result",
      cwd: "/repo/.worktrees/feat-y",
      success: false,
      requestId: "rq-3",
      message: "spawn failed",
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/repo");
    expect(clearSpawningCwd).not.toHaveBeenCalledWith("/repo/.worktrees/feat-y");
    // Entry dropped on failure.
    expect(pending.has("rq-3")).toBe(false);
  });

  it("spawn_result failure with no matching entry falls back to msg.cwd", () => {
    const { dispatch, clearSpawningCwd } = setup(new Map());

    dispatch({
      type: "spawn_result",
      cwd: "/plain/repo",
      success: false,
      message: "spawn failed",
    } as ServerToBrowserMessage);

    expect(clearSpawningCwd).toHaveBeenCalledWith("/plain/repo");
  });
});
