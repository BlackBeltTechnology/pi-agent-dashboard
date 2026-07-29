import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function setup() {
  const sessionsRef = { current: new Map<string, any>() };
  const statesRef = { current: new Map<string, any>() };
  const resetSignalsRef = { current: new Map<string, number>() };
  const setSessions = vi.fn((updater: any) => {
    sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
  });
  const setSessionStates = vi.fn((updater: any) => {
    statesRef.current = typeof updater === "function" ? updater(statesRef.current) : updater;
  });
  const setForceKillResetSignals = vi.fn((updater: any) => {
    resetSignalsRef.current = typeof updater === "function" ? updater(resetSignalsRef.current) : updater;
  });
  const showToast = vi.fn();
  const setters: any = {
    setSessions,
    setSessionStates,
    setSessionCommands: vi.fn(),
    setFileResults: vi.fn(),
    setChangedOnDisk: vi.fn(),
    setOpenspecMap: vi.fn(),
    setFolderGitMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(),
    setFavoriteModels: vi.fn(),
    setWorkspaces: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(),
    setViewMessagesMap: vi.fn(),
    setLoadingHistory: vi.fn(),
    setForceKillResetSignals,
  };
  const deps: any = {
    send: vi.fn(),
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() },
    subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() },
    loadingHistoryTimersRef: { current: new Map() },
    showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);
  return { dispatch, showToast, resetSignalsRef, sessionsRef, statesRef, send: deps.send, pendingSpawnsRef: deps.pendingSpawnsRef };
}

describe("useMessageHandler force_kill_result", () => {
  it("surfaces failure and increments the session reset signal", () => {
    const { dispatch, showToast, resetSignalsRef } = setup();

    dispatch({
      type: "force_kill_result",
      sessionId: "s1",
      success: false,
      message: "Process survived SIGKILL",
    } as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledWith("Process survived SIGKILL", "error");
    expect(resetSignalsRef.current.get("s1")).toBe(1);
  });

  it("marks the session ended on success without auto-resuming", () => {
    const { dispatch, showToast, resetSignalsRef, sessionsRef, statesRef, send, pendingSpawnsRef } = setup();
    sessionsRef.current.set("s1", { id: "s1", status: "ended" });
    statesRef.current.set("s1", {
      ...createInitialState(),
      status: "streaming",
      isStreaming: true,
      pendingPrompt: { text: "x", status: "sending" },
      lastError: { message: "No activity — session may be stuck", timestamp: 1 },
      retryState: { attempt: 1, maxAttempts: 1, delayMs: -1, reason: "x", startedAt: 1 },
    });

    dispatch({
      type: "force_kill_result",
      sessionId: "s1",
      success: true,
      message: "Process tree terminated",
    } as ServerToBrowserMessage);

    expect(showToast).not.toHaveBeenCalled();
    expect(resetSignalsRef.current.size).toBe(0);
    expect(statesRef.current.get("s1")).toMatchObject({
      status: "ended",
      isStreaming: false,
      pendingPrompt: undefined,
      retryState: undefined,
    });
    expect(statesRef.current.get("s1").lastError).toEqual({
      message: "No activity — session may be stuck",
      timestamp: 1,
    });
    expect(sessionsRef.current.get("s1")).toMatchObject({ status: "ended" });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "resume_session" }));
    expect(pendingSpawnsRef.current.size).toBe(0);
  });

  it("preserves the warning reason when a session is marked ended", () => {
    const { dispatch, statesRef } = setup();
    statesRef.current.set("s1", {
      ...createInitialState(),
      status: "streaming",
      isStreaming: true,
      currentTool: "web_search",
      pendingPrompt: { text: "x", status: "sending" },
      lastError: { message: "No activity — session may be stuck", timestamp: 1 },
      retryState: { attempt: 1, maxAttempts: 1, delayMs: -1, reason: "x", startedAt: 1 },
    });

    dispatch({
      type: "session_updated",
      sessionId: "s1",
      updates: { status: "ended", endedAt: 123 },
    } as ServerToBrowserMessage);

    expect(statesRef.current.get("s1")).toMatchObject({
      status: "ended",
      isStreaming: false,
      currentTool: undefined,
      pendingPrompt: undefined,
      lastError: { message: "No activity — session may be stuck", timestamp: 1 },
      retryState: undefined,
    });
  });
});
