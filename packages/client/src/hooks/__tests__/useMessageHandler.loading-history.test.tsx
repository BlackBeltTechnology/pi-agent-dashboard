/**
 * Suite for change: show-chat-history-loading-indicator.
 *
 * Pins the loading-flag exit edges wired into useMessageHandler:
 *  - a non-empty `event_replay` batch clears the flag (first content paints);
 *  - an `event_replay { events:[], isLast:true }` (genuinely-empty session)
 *    clears the flag (→ ChatView falls through to "No messages yet");
 *  - `session_updated { dataUnavailable:true }` (load failure) clears the flag.
 *
 * The flag is cleared via `clearLoadingHistory`, which also tears down the
 * per-session safety-net timer.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import type { SessionState } from "../../lib/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function makeEvt(toolCallId: string, ts: number): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: ts,
    data: { toolCallId, toolName: "bash", args: { command: `cmd-${toolCallId}` } },
  };
}

function setup() {
  const loadingHistoryRef = { current: new Map<string, boolean>() };
  const timersRef = { current: new Map<string, ReturnType<typeof setTimeout>>() };

  const setLoadingHistory = vi.fn((updater: any) => {
    loadingHistoryRef.current =
      typeof updater === "function" ? updater(loadingHistoryRef.current) : updater;
  });

  const setters: any = {
    setSessions: vi.fn(),
    setSessionStates: vi.fn(),
    setSessionCommands: vi.fn(),
    setFileResults: vi.fn(),
    setOpenspecMap: vi.fn(),
    setModelsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(),
    setFavoriteModels: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
    setLoadingHistory,
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
    loadingHistoryTimersRef: timersRef,
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);
  return { dispatch, loadingHistoryRef, timersRef };
}

describe("useMessageHandler loading-history exit edges", () => {
  const SID = "session-1";

  it("non-empty event_replay batch clears the loading flag and its timer", () => {
    const { dispatch, loadingHistoryRef, timersRef } = setup();
    loadingHistoryRef.current.set(SID, true);
    timersRef.current.set(SID, setTimeout(() => {}, 99999));

    dispatch({
      type: "event_replay",
      sessionId: SID,
      events: [{ seq: 1, event: makeEvt("t1", 100) }],
      isLast: false,
    } as ServerToBrowserMessage);

    expect(loadingHistoryRef.current.get(SID)).toBe(false);
    expect(timersRef.current.has(SID)).toBe(false);
  });

  it("empty terminal event_replay (events:[], isLast:true) clears the loading flag", () => {
    const { dispatch, loadingHistoryRef, timersRef } = setup();
    loadingHistoryRef.current.set(SID, true);
    timersRef.current.set(SID, setTimeout(() => {}, 99999));

    dispatch({
      type: "event_replay",
      sessionId: SID,
      events: [],
      isLast: true,
    } as ServerToBrowserMessage);

    expect(loadingHistoryRef.current.get(SID)).toBe(false);
    expect(timersRef.current.has(SID)).toBe(false);
  });

  it("session_updated{dataUnavailable:true} clears the loading flag", () => {
    const { dispatch, loadingHistoryRef, timersRef } = setup();
    loadingHistoryRef.current.set(SID, true);
    timersRef.current.set(SID, setTimeout(() => {}, 99999));

    dispatch({
      type: "session_updated",
      sessionId: SID,
      updates: { dataUnavailable: true },
    } as ServerToBrowserMessage);

    expect(loadingHistoryRef.current.get(SID)).toBe(false);
    expect(timersRef.current.has(SID)).toBe(false);
  });

  it("non-terminal empty event_replay (isLast:false start marker) does NOT clear the flag", () => {
    const { dispatch, loadingHistoryRef } = setup();
    loadingHistoryRef.current.set(SID, true);

    dispatch({
      type: "event_replay",
      sessionId: SID,
      events: [],
      isLast: false,
    } as ServerToBrowserMessage);

    expect(loadingHistoryRef.current.get(SID)).toBe(true);
  });
});
