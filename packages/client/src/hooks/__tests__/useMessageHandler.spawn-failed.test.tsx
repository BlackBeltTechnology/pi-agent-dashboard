/**
 * `onSpawnFailed` — the folder home re-enables Start only for ITS spawn.
 * test-plan F8 (hook level), F9, X7. See change: redesign-directory-home-split.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";
import type { PendingSpawnEntry } from "../useSessionActions.js";

function setup(entries: Record<string, PendingSpawnEntry> = {}) {
  const pending = new Map<string, PendingSpawnEntry>(Object.entries(entries));
  const onSpawnFailed = vi.fn();
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
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set<string>() },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: pending },
    onSpawnFailed,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: unknown) => result.current(m as ServerToBrowserMessage), onSpawnFailed, navigate, pending };
}

describe("useMessageHandler — onSpawnFailed", () => {
  it("a failed spawn_result echoing a requestId notifies once with that id", () => {
    const { dispatch, onSpawnFailed } = setup({ R: { cwd: "/p", kind: "spawn" } });
    dispatch({ type: "spawn_result", cwd: "/p", success: false, message: "boom", requestId: "R" });
    expect(onSpawnFailed).toHaveBeenCalledTimes(1);
    expect(onSpawnFailed).toHaveBeenCalledWith("R");
  });

  it("a successful spawn_result never notifies", () => {
    const { dispatch, onSpawnFailed } = setup({ R: { cwd: "/p", kind: "spawn" } });
    dispatch({ type: "spawn_result", cwd: "/p", success: true, message: "ok", requestId: "R" });
    expect(onSpawnFailed).not.toHaveBeenCalled();
  });

  it("a spawn_register_timeout echoing a requestId notifies with it; one without does not", () => {
    const { dispatch, onSpawnFailed } = setup();
    dispatch({ type: "spawn_register_timeout", cwd: "/p", requestId: "R2" });
    expect(onSpawnFailed).toHaveBeenCalledWith("R2");
    onSpawnFailed.mockClear();
    dispatch({ type: "spawn_register_timeout", cwd: "/p" });
    expect(onSpawnFailed).not.toHaveBeenCalled();
  });

  it("F9/X7: session_added with the spawnRequestId navigates exactly once (App owns navigation)", () => {
    const { dispatch, navigate, onSpawnFailed } = setup({ R: { cwd: "/p", kind: "spawn" } });
    dispatch({
      type: "session_added",
      session: { id: "s1", cwd: "/p", source: "tui", status: "active", startedAt: 1 } as DashboardSession,
      spawnRequestId: "R",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/session/s1");
    expect(onSpawnFailed).not.toHaveBeenCalled();
  });
});
