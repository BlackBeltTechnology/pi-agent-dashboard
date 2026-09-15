/**
 * Live-observed death reason reaches the client.
 * See change: stop-discarding-known-session-state (local review, blocking fix).
 *
 * The client's only live channel for a session record is the partial merge in
 * `useMessageHandler` (`{...existing, ...msg.updates}`); a terminal
 * `session_updated` MUST carry `closedReason` or a watching dashboard shows a
 * bare `ended` until the next reconnect snapshot. This pins the client half of
 * that contract. Harness copied from `useMessageHandler.session-orphaned.test.tsx`.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  const session = {
    id: "s1",
    cwd: "/tmp/repo",
    source: "tui",
    status: "streaming",
    startedAt: 1,
  } as DashboardSession;
  const sessionsRef = { current: new Map([["s1", session]]) };
  const statesRef = { current: new Map() };
  const setSessions = vi.fn((updater: any) => {
    sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
  });
  const setSessionStates = vi.fn((updater: any) => {
    statesRef.current = typeof updater === "function" ? updater(statesRef.current) : updater;
  });
  const setters: any = {
    setSessions, setSessionStates, setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setChangedOnDisk: vi.fn(), setOpenspecMap: vi.fn(), setFolderGitMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(), setModelsMap: vi.fn(), setModelRefreshErrorsMap: vi.fn(),
    setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(), setWorkspaces: vi.fn(), setTerminals: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(), setLoadingHistory: vi.fn(), setReplayInFlight: vi.fn(), setCanvasMap: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
    replayInFlightTimersRef: { current: new Map() }, showToast: vi.fn(),
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => result.current(m), sessionsRef };
}

describe("useMessageHandler terminal session_updated", () => {
  it("merges a closedReason carried on the terminal broadcast", () => {
    const { dispatch, sessionsRef } = setup();

    dispatch({
      type: "session_updated",
      sessionId: "s1",
      updates: { status: "ended", endedAt: 5, closedReason: "process_gone" },
    } as ServerToBrowserMessage);

    const s = sessionsRef.current.get("s1")!;
    expect(s.status).toBe("ended");
    expect(s.closedReason).toBe("process_gone");
  });
});
