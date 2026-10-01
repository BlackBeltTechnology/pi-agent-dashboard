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

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLoadingHistory, HYDRATE_CEILING_MS, SUBSCRIBE_ACK_MS } from "../../lib/replay/loading-history.js";
import { contentReplay, setupHistoryLoad } from "../../test-support/history-load-harness.js";
import { useMessageHandler } from "../useMessageHandler.js";

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
    // Second replay flag, unasserted here — supplied so the handler's
    // `replayInFlight` edges have a setter to call.
    // See change: show-replay-in-flight-indicator.
    setReplayInFlight: vi.fn(),
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
    replayInFlightTimersRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);
  return { dispatch, loadingHistoryRef, timersRef, setLoadingHistory };
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

/**
 * Suite for change: fix-history-loading-false-empty-flash.
 *
 * Pins the two-stage safety net: the short `SUBSCRIBE_ACK_MS` window arms on
 * `subscribe`; the cold-hydration start marker and every server heartbeat
 * (empty `event_replay { isLast: false }`) re-arm the longer `HYDRATE_CEILING_MS`
 * window so a slow disk parse never surfaces "No messages yet".
 */
describe("useMessageHandler two-stage safety net (re-arm)", () => {
  const SID = "session-rearm";

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Mirror App.tsx `beginLoadingHistory`: set the flag + arm the short window.
  function beginLoading(
    setLoadingHistory: (u: any) => void,
    timersRef: { current: Map<string, ReturnType<typeof setTimeout>> },
  ) {
    setLoadingHistory((prev: Map<string, boolean>) => new Map(prev).set(SID, true));
    timersRef.current.set(
      SID,
      setTimeout(() => clearLoadingHistory(setLoadingHistory as any, timersRef as any, SID), SUBSCRIBE_ACK_MS),
    );
  }

  const primingMarker = { type: "event_replay", sessionId: SID, events: [], isLast: false } as ServerToBrowserMessage;
  const contentBatch = {
    type: "event_replay",
    sessionId: SID,
    events: [{ seq: 1, event: makeEvt("t1", 100) }],
    isLast: false,
  } as ServerToBrowserMessage;

  it("4.1 cold path: priming marker keeps flag set past 15s; content clears", () => {
    const { dispatch, loadingHistoryRef, setLoadingHistory, timersRef } = setup();
    beginLoading(setLoadingHistory, timersRef);
    dispatch(primingMarker);
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS + 1000);
    expect(loadingHistoryRef.current.get(SID)).toBe(true);
    dispatch(contentBatch);
    expect(loadingHistoryRef.current.get(SID)).toBe(false);
  });

  it("4.2 dead-link path: no priming marker → cleared at 15s", () => {
    const { loadingHistoryRef, setLoadingHistory, timersRef } = setup();
    beginLoading(setLoadingHistory, timersRef);
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS + 1);
    expect(loadingHistoryRef.current.get(SID)).toBe(false);
    expect(timersRef.current.has(SID)).toBe(false);
  });

  it("4.3 stuck-worker path: priming marker, no heartbeats → cleared at 90s", () => {
    const { dispatch, loadingHistoryRef, setLoadingHistory, timersRef } = setup();
    beginLoading(setLoadingHistory, timersRef);
    dispatch(primingMarker);
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS + 1000);
    expect(loadingHistoryRef.current.get(SID)).toBe(true);
    vi.advanceTimersByTime(HYDRATE_CEILING_MS);
    expect(loadingHistoryRef.current.get(SID)).toBe(false);
  });

  it("4.4 heartbeat re-arm: beats spaced < 90s keep flag set past 90s; clears after beats stop", () => {
    const { dispatch, loadingHistoryRef, setLoadingHistory, timersRef } = setup();
    beginLoading(setLoadingHistory, timersRef);
    dispatch(primingMarker);
    // Three heartbeats spaced 60s apart: total 180s > 90s ceiling, but each gap < 90s.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(60000);
      expect(loadingHistoryRef.current.get(SID)).toBe(true);
      dispatch(primingMarker); // heartbeat re-arms
    }
    // Beats stop: flag holds until the ceiling elapses, then clears.
    vi.advanceTimersByTime(HYDRATE_CEILING_MS - 1);
    expect(loadingHistoryRef.current.get(SID)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(loadingHistoryRef.current.get(SID)).toBe(false);
  });

  it("4.5 empty session: priming then {events:[], isLast:true} → cleared", () => {
    const { dispatch, loadingHistoryRef, setLoadingHistory, timersRef } = setup();
    beginLoading(setLoadingHistory, timersRef);
    dispatch(primingMarker);
    dispatch({ type: "event_replay", sessionId: SID, events: [], isLast: true } as ServerToBrowserMessage);
    expect(loadingHistoryRef.current.get(SID)).toBe(false);
    expect(timersRef.current.has(SID)).toBe(false);
  });

  it("4.6 warm regression: content-only replay clears on first content < 15s", () => {
    const { dispatch, loadingHistoryRef, setLoadingHistory, timersRef } = setup();
    beginLoading(setLoadingHistory, timersRef);
    vi.advanceTimersByTime(5000);
    dispatch(contentBatch);
    expect(loadingHistoryRef.current.get(SID)).toBe(false);
    expect(timersRef.current.has(SID)).toBe(false);
  });
});

/**
 * Suite for change: show-session-history-load-state — failed mark + startedAt
 * clock, driven through the real `useHistoryLoadState` + `useMessageHandler`.
 */
describe("history-load failed mark + startedAt (show-session-history-load-state)", () => {
  const SID = "s-hl";
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("#E5 startedAt rules: not armed → set; armed+present → unchanged; restart → reset; armed+missing → set", () => {
    const h = setupHistoryLoad();
    // not armed → set to now
    h.begin(SID);
    expect(h.cur().hl.historyLoadStartedAt.get(SID)).toBe(1_000_000);
    // armed + present → unchanged
    vi.setSystemTime(1_005_000);
    h.begin(SID);
    expect(h.cur().hl.historyLoadStartedAt.get(SID)).toBe(1_000_000);
    // armed + restart → reset
    vi.setSystemTime(1_007_000);
    h.begin(SID, { restart: true });
    expect(h.cur().hl.historyLoadStartedAt.get(SID)).toBe(1_007_000);
    // armed + missing → set (other session armed via timers only)
    const OTHER = "s-other";
    act(() => h.cur().hl.beginReplayInFlight(OTHER));
    expect(h.cur().hl.historyLoadStartedAt.has(OTHER)).toBe(false);
    vi.setSystemTime(1_009_000);
    act(() => h.cur().hl.beginLoadingHistory(OTHER));
    expect(h.cur().hl.historyLoadStartedAt.get(OTHER)).toBe(1_009_000);
  });

  it("#X1 dead-link subscribe fails at the short window", () => {
    const h = setupHistoryLoad();
    h.begin(SID);
    h.advance(SUBSCRIBE_ACK_MS);
    expect(h.cur().hl.loadingHistory.get(SID)).toBe(false);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBe(true);
    expect(h.cur().hl.replayInFlight.get(SID)).toBe(false);
    expect(h.phase(SID)).toBe("failed");
  });

  it("#X2 stuck hydration fails at the ceiling; the replayInFlight rearm never invokes onTimeout", () => {
    const h = setupHistoryLoad();
    h.begin(SID);
    h.dispatch({ type: "event_replay", sessionId: SID, events: [], isLast: false } as ServerToBrowserMessage);
    h.advance(SUBSCRIBE_ACK_MS + 1000);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBeFalsy();
    h.advance(HYDRATE_CEILING_MS);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBe(true);
    // Exactly one failure mark: the loadingHistory rearm site. The replayInFlight
    // rearm (same batch) carries no onTimeout.
    expect(h.markSpy).toHaveBeenCalledTimes(1);
    expect(h.phase(SID)).toBe("failed");
  });

  it("#X3 timeout after content is not a failure", () => {
    const h = setupHistoryLoad();
    h.begin(SID);
    h.dispatch(contentReplay(SID));
    h.advance(SUBSCRIBE_ACK_MS + HYDRATE_CEILING_MS + 1000);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBeFalsy();
    expect(h.cur().sessionStates.get(SID)?.messages.length).toBeGreaterThan(0);
  });

  it("#X4 dataUnavailable marks failed only when a load is in flight", () => {
    const h = setupHistoryLoad();
    h.begin(SID);
    h.dispatch({ type: "session_updated", sessionId: SID, updates: { dataUnavailable: true } } as ServerToBrowserMessage);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBe(true);
    expect(h.phase(SID)).toBe("failed");
    const NEVER = "s-never";
    h.dispatch({ type: "session_updated", sessionId: NEVER, updates: { dataUnavailable: true } } as ServerToBrowserMessage);
    expect(h.cur().hl.historyLoadFailed.get(NEVER)).toBeFalsy();
    expect(h.phase(NEVER, false)).toBe("idle");
  });

  it("#X5 late terminal clears the failure → idle (connected, empty → 'No messages yet')", () => {
    const h = setupHistoryLoad();
    h.begin(SID);
    h.advance(SUBSCRIBE_ACK_MS);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBe(true);
    h.dispatch({ type: "event_replay", sessionId: SID, events: [], isLast: true } as ServerToBrowserMessage);
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBe(false);
    expect(h.phase(SID)).toBe("idle");
  });

  it("non-empty batch after a failure clears the failed mark", () => {
    const h = setupHistoryLoad();
    h.begin(SID);
    h.advance(SUBSCRIBE_ACK_MS);
    h.dispatch(contentReplay(SID));
    expect(h.cur().hl.historyLoadFailed.get(SID)).toBe(false);
  });
});
