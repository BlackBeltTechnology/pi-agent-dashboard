/**
 * Confirmed session termination converges retry/error state.
 *
 * `session_orphaned` reports a surviving process through its separate toast;
 * the following `session_removed` still ends the session and hides any stale
 * retry/error banner. See changes: fix-tmux-session-shutdown-leak,
 * fix-retry-error-lifecycle.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { useMessageHandler } from "../useMessageHandler.js";

function setup() {
  const showToast = vi.fn();
  const session = {
    id: "s1",
    cwd: "/tmp/repo",
    source: "tui",
    status: "active",
    startedAt: 1,
  } as DashboardSession;
  const retrying: SessionState = {
    ...createInitialState(),
    status: "streaming",
    isStreaming: true,
    messages: [{ id: "m1", role: "assistant", content: "kept", timestamp: 1 }],
    tokensIn: 42,
    lastError: { message: "503 overloaded", timestamp: 2 },
    retryState: {
      attempt: 2,
      maxAttempts: 3,
      delayMs: 4000,
      waiting: true,
      reason: "503 overloaded",
      startedAt: 2,
    },
  };
  const sessionsRef = { current: new Map([["s1", session]]) };
  const statesRef = { current: new Map([["s1", retrying]]) };
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
    replayInFlightTimersRef: { current: new Map() }, showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (message: ServerToBrowserMessage) => result.current(message),
    showToast,
    sessionsRef,
    statesRef,
  };
}

describe("useMessageHandler confirmed termination", () => {
  it("warns the user and names a surviving orphan pid", () => {
    const { dispatch, showToast } = setup();

    dispatch({ type: "session_orphaned", sessionId: "s1", pid: 18163 } as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(String(showToast.mock.calls[0][0])).toContain("18163");
    expect(showToast.mock.calls[0][1]).toBe("error");
  });

  it("F6/X5 session_removed marks ended and clears retry/error while preserving history", () => {
    const { dispatch, sessionsRef, statesRef } = setup();

    dispatch({ type: "session_removed", sessionId: "s1" } as ServerToBrowserMessage);

    expect(sessionsRef.current.get("s1")?.status).toBe("ended");
    const state = statesRef.current.get("s1")!;
    expect(state.status).toBe("ended");
    expect(state.isStreaming).toBe(false);
    expect(state.retryState).toBeUndefined();
    expect(state.lastError).toBeUndefined();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("kept");
    expect(state.tokensIn).toBe(42);
  });

  it("X6 orphan warning survives removal and retry/error still clears", () => {
    const { dispatch, showToast, statesRef } = setup();

    dispatch({ type: "session_orphaned", sessionId: "s1", pid: 18163 } as ServerToBrowserMessage);
    dispatch({ type: "session_removed", sessionId: "s1" } as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(statesRef.current.get("s1")?.retryState).toBeUndefined();
    expect(statesRef.current.get("s1")?.lastError).toBeUndefined();
  });

  it("a clean session_removed emits no orphan toast", () => {
    const { dispatch, showToast } = setup();

    dispatch({ type: "session_removed", sessionId: "s1" } as ServerToBrowserMessage);

    expect(showToast).not.toHaveBeenCalled();
  });
});
