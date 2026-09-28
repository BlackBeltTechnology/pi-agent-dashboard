/**
 * Shared integrated harness for change: show-session-history-load-state.
 * Composes the real `useHistoryLoadState` with the real `useMessageHandler`
 * (real `setSessionStates`), mirroring App's wiring of the failed mark.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { vi } from "vitest";
import { useHistoryLoadState } from "../hooks/useHistoryLoadState.js";
import { useMessageHandler } from "../hooks/useMessageHandler.js";
import type { SessionState } from "../lib/chat/event-reducer.js";
import { deriveHistoryLoadPhase, hasChatContent } from "../lib/replay/history-load-phase.js";

export function setupHistoryLoad(initialStatus = "connected") {
  const markSpy = vi.fn();
  const hook = renderHook(
    ({ status }: { status: string }) => {
      const [sessionStates, setSessionStates] = useState<Map<string, SessionState>>(new Map());
      const statesRef = useRef(sessionStates);
      statesRef.current = sessionStates;
      const hl = useHistoryLoadState({ status, hasContent: (id) => hasChatContent(statesRef.current.get(id)) });
      const { markHistoryLoadFailed: mark } = hl;
      const markHistoryLoadFailed = useCallback((id: string) => {
        markSpy(id);
        mark(id);
      }, [mark]);
      const setters: any = {
        setSessions: vi.fn(), setSessionStates, setSessionCommands: vi.fn(), setFileResults: vi.fn(),
        setOpenspecMap: vi.fn(), setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(),
        setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
        setTerminals: vi.fn(), setEditorStatuses: vi.fn(), setDiscoveredServers: vi.fn(),
        setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
        setLoadingHistory: hl.setLoadingHistory, setReplayInFlight: hl.setReplayInFlight,
      };
      const deps: any = {
        send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
        spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
        pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
        maxSeqMapRef: { current: new Map<string, number>() }, selectedSessionIdRef: { current: undefined },
        pendingSpawnsRef: { current: new Map() },
        loadingHistoryTimersRef: hl.loadingHistoryTimersRef, replayInFlightTimersRef: hl.replayInFlightTimersRef,
        markHistoryLoadFailed, clearHistoryLoadFailed: hl.clearHistoryLoadFailed,
      };
      const handler = useMessageHandler(setters, deps);
      return { hl, handler, sessionStates, status };
    },
    { initialProps: { status: initialStatus } },
  );
  const cur = () => hook.result.current;
  const dispatch = (msg: ServerToBrowserMessage) => act(() => cur().handler(msg));
  const phase = (id: string, selected = true) =>
    deriveHistoryLoadPhase({
      selected,
      connected: cur().status === "connected",
      hasContent: hasChatContent(cur().sessionStates.get(id)),
      loading: !!cur().hl.loadingHistory.get(id) || !!cur().hl.replayInFlight.get(id),
      failed: !!cur().hl.historyLoadFailed.get(id),
    });
  const begin = (id: string, opts?: { restart?: boolean }) =>
    act(() => {
      cur().hl.beginLoadingHistory(id, opts);
      cur().hl.beginReplayInFlight(id);
    });
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  const setStatus = (status: string) => hook.rerender({ status });
  return { hook, cur, dispatch, phase, begin, advance, setStatus, markSpy };
}

/** A content batch that reduces into `state.messages`. */
export function contentReplay(sessionId: string, isLast = false): ServerToBrowserMessage {
  return {
    type: "event_replay",
    sessionId,
    events: [
      { seq: 1, event: { eventType: "message_start", timestamp: 1, data: { message: { role: "user", content: "hi" } } } },
      { seq: 2, event: { eventType: "message_end", timestamp: 2, data: { entryId: "u1", message: { role: "user", content: "hi" } } } },
    ],
    isLast,
  } as unknown as ServerToBrowserMessage;
}
