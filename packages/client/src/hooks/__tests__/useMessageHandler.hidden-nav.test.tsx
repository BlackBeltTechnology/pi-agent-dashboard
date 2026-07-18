/**
 * Regression suite for change: suppress-hidden-session-auto-navigation.
 *
 * A headless worker (subagent, `memory` tool, nested `pi -p`) registers with
 * `hasUI:false`; the server auto-hides it and broadcasts
 * `session_added { hidden: true, cwd: <parent cwd> }`. Because it shares the
 * parent session's cwd, the Tier 1 / Tier 2 / Tier 2.5 correlation cascade can
 * steal focus (navigate) AND consume the correlation token minted for the real
 * visible spawn. A `hidden` session SHALL never navigate and SHALL never
 * consume correlation state; it SHALL still be added to the session map.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(id: string, cwd: string, hidden?: boolean): DashboardSession {
  return { id, cwd, source: "tui", status: "active", startedAt: 1, hidden } as DashboardSession;
}

function setup(
  pending: Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>,
  spawningCwds = new Set<string>(),
) {
  const clearSpawningCwd = vi.fn();
  const navigate = vi.fn();
  const setSessions = vi.fn();
  const setters: any = {
    setSessions, setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(), setLoadingHistory: vi.fn(),
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
    loadingHistoryTimersRef: { current: new Map() },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (m: ServerToBrowserMessage) => result.current(m),
    clearSpawningCwd, navigate, pending, spawningCwds, setSessions,
  };
}

describe("useMessageHandler — suppress hidden session auto-navigation", () => {
  it("Tier 1: hidden session never navigates, never consumes pending spawn", () => {
    const pending = new Map([
      ["rq_42", { cwd: "/repo", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate, setSessions } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("worker-1", "/repo", true),
      spawnRequestId: "rq_42",
    } as ServerToBrowserMessage);

    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_42")).toBe(true);
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    // Hidden session still added to the session map.
    expect(setSessions).toHaveBeenCalled();
  });

  it("Tier 2: hidden session never navigates, never clears spawningCwds", () => {
    const { dispatch, clearSpawningCwd, navigate, spawningCwds } = setup(
      new Map(),
      new Set(["/repo"]),
    );

    dispatch({
      type: "session_added",
      session: makeSession("worker-2", "/repo", true),
      // NO spawnRequestId → would otherwise hit Tier 2 (cwd in spawningCwds).
    } as ServerToBrowserMessage);

    expect(navigate).not.toHaveBeenCalled();
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(spawningCwds.has("/repo")).toBe(true);
  });

  it("Tier 2.5: hidden worker does not consume real spawn correlation", () => {
    const pending = new Map([
      ["rq_99", { cwd: "/repo", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, clearSpawningCwd, navigate, setSessions } = setup(pending);

    // Hidden worker in the SAME cwd arrives first, no matching spawnRequestId.
    dispatch({
      type: "session_added",
      session: makeSession("worker-3", "/repo", true),
    } as ServerToBrowserMessage);

    expect(navigate).not.toHaveBeenCalled();
    expect(pending.has("rq_99")).toBe(true);
    expect(clearSpawningCwd).not.toHaveBeenCalled();
    expect(setSessions).toHaveBeenCalled();

    // The real visible session later arrives with the matching token.
    dispatch({
      type: "session_added",
      session: makeSession("real-3", "/repo", false),
      spawnRequestId: "rq_99",
    } as ServerToBrowserMessage);

    expect(navigate).toHaveBeenCalledWith("/session/real-3");
    expect(pending.has("rq_99")).toBe(false);
  });

  it("positive control: visible session still navigates and consumes its token", () => {
    const pending = new Map([
      ["rq_7", { cwd: "/repo", kind: "spawn" as const, placeholderCwd: "/repo" }],
    ]);
    const { dispatch, navigate } = setup(pending);

    dispatch({
      type: "session_added",
      session: makeSession("real-7", "/repo", false),
      spawnRequestId: "rq_7",
    } as ServerToBrowserMessage);

    expect(navigate).toHaveBeenCalledWith("/session/real-7");
    expect(pending.has("rq_7")).toBe(false);
  });
});
