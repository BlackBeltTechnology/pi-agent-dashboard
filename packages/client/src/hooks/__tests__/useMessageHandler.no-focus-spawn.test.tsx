/**
 * Suite for change: openspec-board-spawn-no-focus (test-plan #E1–E10, F1, X1).
 *
 * A pending spawn recorded with `focus: false` (OpenSpec board) runs the same
 * correlation cleanup as a default spawn but never navigates — on the
 * requestId tier and on the cwd fallback tiers (2 / 2.5).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";
import type { PendingSpawnEntry } from "../useSessionActions.js";

function makeSession(id: string, cwd: string, extra: Partial<DashboardSession> = {}): DashboardSession {
  return { id, cwd, source: "tui", status: "active", startedAt: 1, ...extra } as DashboardSession;
}

function setup(entries: Record<string, PendingSpawnEntry>, spawningCwds: string[] = []) {
  const pending = new Map<string, PendingSpawnEntry>(Object.entries(entries));
  const clearSpawningCwd = vi.fn();
  const navigate = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(),
    navigate,
    clearSpawningCwd,
    spawningCwdsRef: { current: new Set(spawningCwds) },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: pending },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: unknown) => result.current(m as ServerToBrowserMessage), clearSpawningCwd, navigate, pending };
}

const added = (session: DashboardSession, extra: Record<string, unknown> = {}) =>
  ({ type: "session_added", session, ...extra });

describe("useMessageHandler — no-focus spawn (openspec-board-spawn-no-focus)", () => {
  it("E1: Tier 1 requestId match cleans up without navigating", () => {
    const { dispatch, navigate, pending, clearSpawningCwd } = setup(
      { rq_50: { cwd: "/p", kind: "spawn", focus: false } }, ["/p"]);
    dispatch(added(makeSession("s1", "/p"), { spawnRequestId: "rq_50" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_50")).toBe(false);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/p");
  });

  it("E2: default entry (no focus key) still navigates", () => {
    const { dispatch, navigate, pending } = setup({ rq_42: { cwd: "/p", kind: "spawn" } }, ["/p"]);
    dispatch(added(makeSession("s2", "/p"), { spawnRequestId: "rq_42" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/session/s2");
    expect(pending.has("rq_42")).toBe(false);
  });

  it("E3: worktree no-focus entry matched by cwd fallback (Tier 2.5) does not navigate", () => {
    const { dispatch, navigate, pending, clearSpawningCwd } = setup(
      { rq_w: { cwd: "/p/.worktrees/x", kind: "spawn", placeholderCwd: "/p", focus: false } }, ["/p"]);
    dispatch(added(makeSession("s3", "/p/.worktrees/x")));
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_w")).toBe(false);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/p");
  });

  it("E4: Tier 2 legacy no-focus entry does not navigate", () => {
    const { dispatch, navigate, pending, clearSpawningCwd } = setup(
      { rq_p: { cwd: "/p", kind: "spawn", focus: false } }, ["/p"]);
    dispatch(added(makeSession("s4", "/p")));
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_p")).toBe(false);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/p");
  });

  it("E5: mixed fallback match still focuses", () => {
    const { dispatch, navigate, pending } = setup({
      rq_a: { cwd: "/p", kind: "spawn", focus: false },
      rq_b: { cwd: "/p", kind: "spawn" },
    }, ["/p"]);
    dispatch(added(makeSession("s5", "/p")));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/session/s5");
    expect(pending.size).toBe(1);
  });

  it("E6: zero fallback matches behaves as before (navigate + clear)", () => {
    const { dispatch, navigate, clearSpawningCwd } = setup({}, ["/p"]);
    dispatch(added(makeSession("s6", "/p")));
    expect(navigate).toHaveBeenCalledWith("/session/s6");
    expect(clearSpawningCwd).toHaveBeenCalledWith("/p");
  });

  it("E7: no-focus intent does not leak to another spawn", () => {
    const { dispatch, navigate, pending } = setup({
      rq_60: { cwd: "/p", kind: "spawn", focus: false },
      rq_61: { cwd: "/q", kind: "spawn" },
    });
    dispatch(added(makeSession("s7", "/q"), { spawnRequestId: "rq_61" }));
    expect(navigate).toHaveBeenCalledWith("/session/s7");
    expect(pending.has("rq_60")).toBe(true);
  });

  it("E8: parent-cwd session does not consume a worktree entry (match on entry.cwd)", () => {
    const { dispatch, navigate, pending } = setup(
      { rq_w: { cwd: "/p/.worktrees/x", kind: "spawn", placeholderCwd: "/p", focus: false } }, ["/p"]);
    dispatch(added(makeSession("s8", "/p")));
    expect(pending.has("rq_w")).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/session/s8");
  });

  it("E9: reconciled add never navigates, still consumes exact match", () => {
    const { dispatch, navigate, pending, clearSpawningCwd } = setup(
      { rq_50: { cwd: "/p", kind: "spawn", focus: false } }, ["/p"]);
    dispatch(added(makeSession("s9", "/p"), { spawnRequestId: "rq_50", reconciled: true }));
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_50")).toBe(false);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/p");
  });

  it("E10: hidden session consumes nothing and never navigates", () => {
    const { dispatch, navigate, pending, clearSpawningCwd } = setup(
      { rq_50: { cwd: "/p", kind: "spawn", focus: false } }, ["/p"]);
    dispatch(added(makeSession("s10", "/p", { hidden: true }), { spawnRequestId: "rq_50" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_50")).toBe(true);
    expect(clearSpawningCwd).not.toHaveBeenCalled();
  });

  it("F1: intent is honored regardless of where the user is (route-independent)", () => {
    // The decision reads only the pending entry, never the location: arrival
    // after the user left the board is the same code path as E1.
    const { dispatch, navigate, pending } = setup({ rq_50: { cwd: "/p", kind: "spawn", focus: false } });
    window.history.pushState({}, "", "/settings");
    dispatch(added(makeSession("s11", "/p"), { spawnRequestId: "rq_50" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_50")).toBe(false);
  });

  it("X1: failed spawn_result clears a no-focus entry without navigating", () => {
    const { dispatch, navigate, pending, clearSpawningCwd } = setup(
      { rq_50: { cwd: "/p", kind: "spawn", focus: false } }, ["/p"]);
    dispatch({ type: "spawn_result", success: false, requestId: "rq_50", cwd: "/p", error: "boom" });
    expect(pending.has("rq_50")).toBe(false);
    expect(clearSpawningCwd).toHaveBeenCalledWith("/p");
    expect(navigate).not.toHaveBeenCalled();
  });
});
