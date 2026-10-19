/**
 * Suite for change: fix-orphaned-ended-session-archive (test-plan #F1).
 *
 * Pins the `archive_session_error` handling in useMessageHandler: an error
 * toast carries the server's text, and no session state changes (the card is
 * still there; the user just learns why the click did nothing).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  let sessions = new Map<string, DashboardSession>([
    ["S", { id: "S", cwd: "/w", status: "ended", source: "tui", startedAt: 1 } as DashboardSession],
  ]);
  const before = new Map(sessions);
  const setSessions = vi.fn((updater: any) => {
    sessions = typeof updater === "function" ? updater(sessions) : updater;
  });
  const setSessionStates = vi.fn();
  const showToast = vi.fn();
  const setters: any = {
    setSessions, setSessionStates, setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setModelsMap: vi.fn(),
    setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(), setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(), setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(), setLoadingHistory: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
    showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (m: ServerToBrowserMessage) => result.current(m),
    showToast,
    setSessions,
    setSessionStates,
    getSessions: () => sessions,
    before,
  };
}

describe("useMessageHandler archive_session_error", () => {
  it("toasts the server's error text and leaves the session unchanged", () => {
    const rig = setup();

    rig.dispatch({ type: "archive_session_error", sessionId: "S", error: "session is running" } as ServerToBrowserMessage);

    expect(rig.showToast).toHaveBeenCalledTimes(1);
    expect(rig.showToast.mock.calls[0][0]).toContain("session is running");
    expect(rig.showToast.mock.calls[0][1]).toBe("error");
    expect(rig.setSessions).not.toHaveBeenCalled();
    expect(rig.setSessionStates).not.toHaveBeenCalled();
    expect(rig.getSessions()).toEqual(rig.before);
  });
});
