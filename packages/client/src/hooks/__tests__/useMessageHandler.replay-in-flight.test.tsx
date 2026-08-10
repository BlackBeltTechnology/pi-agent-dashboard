/**
 * Suite for change: show-replay-in-flight-indicator.
 *
 * Pins the `replayInFlight` flag, the SECOND per-session replay flag that
 * deliberately diverges from `loadingHistory`:
 *
 *  - `loadingHistory` clears on FIRST CONTENT (so partial history paints);
 *  - `replayInFlight` clears only on the TERMINAL batch (`isLast: true`), the
 *    failure edge, or a safety-net timeout — it is what "the transcript is
 *    still filling in" means.
 *
 * Sibling of `useMessageHandler.loading-history.test.tsx`, whose harness glue
 * this file copies.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLoadingHistory, HYDRATE_CEILING_MS, SUBSCRIBE_ACK_MS } from "../../lib/replay/loading-history.js";
import { useMessageHandler } from "../useMessageHandler.js";

function makeEvt(toolCallId: string, ts: number): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: ts,
    data: { toolCallId, toolName: "bash", args: { command: `cmd-${toolCallId}` } },
  };
}

function batch(sessionId: string, seqs: number[], isLast: boolean): ServerToBrowserMessage {
  return {
    type: "event_replay",
    sessionId,
    events: seqs.map((seq) => ({ seq, event: makeEvt(`t${seq}`, 100 + seq) })),
    isLast,
  } as ServerToBrowserMessage;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function setup() {
  const loadingHistoryRef = { current: new Map<string, boolean>() };
  const timersRef = { current: new Map<string, ReturnType<typeof setTimeout>>() };
  const replayInFlightRef = { current: new Map<string, boolean>() };
  const replayTimersRef = { current: new Map<string, ReturnType<typeof setTimeout>>() };
  const sessionStatesRef = { current: new Map<string, unknown>() };

  const setLoadingHistory = vi.fn((updater: any) => {
    loadingHistoryRef.current =
      typeof updater === "function" ? updater(loadingHistoryRef.current) : updater;
  });
  const setReplayInFlight = vi.fn((updater: any) => {
    replayInFlightRef.current =
      typeof updater === "function" ? updater(replayInFlightRef.current) : updater;
  });

  const setters: any = {
    setSessions: vi.fn(),
    setSessionStates: vi.fn((updater: any) => {
      sessionStatesRef.current =
        typeof updater === "function" ? updater(sessionStatesRef.current) : updater;
    }),
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
    setReplayInFlight,
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
    replayInFlightTimersRef: replayTimersRef,
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);
  return {
    dispatch,
    loadingHistoryRef,
    timersRef,
    replayInFlightRef,
    replayTimersRef,
    setLoadingHistory,
    setReplayInFlight,
    sessionStatesRef,
  };
}

/** Mirror App.tsx `beginReplayInFlight` / `beginLoadingHistory`: set + arm. */
function armBoth(s: ReturnType<typeof setup>, sid: string) {
  s.setLoadingHistory((prev: Map<string, boolean>) => new Map(prev).set(sid, true));
  s.timersRef.current.set(
    sid,
    setTimeout(() => clearLoadingHistory(s.setLoadingHistory as any, s.timersRef as any, sid), SUBSCRIBE_ACK_MS),
  );
  s.setReplayInFlight((prev: Map<string, boolean>) => new Map(prev).set(sid, true));
  s.replayTimersRef.current.set(
    sid,
    setTimeout(() => clearLoadingHistory(s.setReplayInFlight as any, s.replayTimersRef as any, sid), SUBSCRIBE_ACK_MS),
  );
}

describe("useMessageHandler replayInFlight — clear/re-arm edges", () => {
  const SID = "session-rif";

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("E1 first content does NOT clear replayInFlight (loadingHistory clears)", () => {
    const s = setup();
    armBoth(s, SID);

    s.dispatch(batch(SID, range(1, 200), false));

    expect(s.replayInFlightRef.current.get(SID)).toBe(true);
    expect(s.loadingHistoryRef.current.get(SID)).toBe(false);
    const state = (s.sessionStatesRef.current as Map<string, any>).get(SID);
    expect(state.messages.length + state.toolCalls.size).toBeGreaterThan(0);
  });

  it("E2 a terminal batch with content clears replayInFlight", () => {
    const s = setup();
    armBoth(s, SID);

    s.dispatch(batch(SID, [1], true));

    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
  });

  it("E3 an empty terminal batch clears both flags", () => {
    const s = setup();
    armBoth(s, SID);

    s.dispatch(batch(SID, [], true));

    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
    expect(s.loadingHistoryRef.current.get(SID)).toBe(false);
  });

  it("E4 the two flags diverge across a multi-batch replay", () => {
    const s = setup();
    armBoth(s, SID);

    s.dispatch(batch(SID, range(1, 200), false));
    expect([s.loadingHistoryRef.current.get(SID), s.replayInFlightRef.current.get(SID)]).toEqual([false, true]);

    s.dispatch(batch(SID, [201], true));
    expect([s.loadingHistoryRef.current.get(SID), s.replayInFlightRef.current.get(SID)]).toEqual([false, false]);
  });

  it("X1 session_updated{dataUnavailable:true} clears replayInFlight", () => {
    const s = setup();
    armBoth(s, SID);

    s.dispatch({ type: "session_updated", sessionId: SID, updates: { dataUnavailable: true } } as ServerToBrowserMessage);

    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
    expect(s.replayTimersRef.current.has(SID)).toBe(false);
  });

  it("X2 a lost terminal batch is cleared by the armed safety-net window", () => {
    const s = setup();
    armBoth(s, SID);

    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS + 1);

    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
    expect(s.replayTimersRef.current.has(SID)).toBe(false);
  });

  it("X3 clearing is one-way: a later non-terminal batch does not re-set the flag", () => {
    const s = setup();
    armBoth(s, SID);
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS + 1);
    expect(s.replayInFlightRef.current.get(SID)).toBe(false);

    s.dispatch(batch(SID, [1], false));

    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
    expect(s.replayTimersRef.current.has(SID)).toBe(false);
  });

  it("X4 slow transfer: content batches re-arm the ceiling, flag survives past it (Decision 7)", () => {
    const s = setup();
    armBoth(s, SID);

    // Gaps > SUBSCRIBE_ACK_MS but < HYDRATE_CEILING_MS; total span > HYDRATE_CEILING_MS.
    const gap = 30000;
    for (let i = 1; i <= 4; i++) {
      s.dispatch(batch(SID, [i], false)); // content batch re-arms the ceiling
      vi.advanceTimersByTime(gap);
      expect(s.replayInFlightRef.current.get(SID)).toBe(true);
    }
    expect(gap * 4).toBeGreaterThan(HYDRATE_CEILING_MS);

    s.dispatch(batch(SID, [5], true));
    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
  });

  it("X5 a silent wire after a re-arm still clears at the ceiling", () => {
    const s = setup();
    armBoth(s, SID);
    s.dispatch(batch(SID, [1], false));

    vi.advanceTimersByTime(HYDRATE_CEILING_MS - 1);
    expect(s.replayInFlightRef.current.get(SID)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
  });

  it("X7 an old server that never terminates an empty replay degrades to the safety net", () => {
    const s = setup();
    armBoth(s, SID);

    // Old server: nothing at all on the wire for an empty payload.
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS + 1);

    expect(s.replayInFlightRef.current.get(SID)).toBe(false);
    expect(s.replayTimersRef.current.has(SID)).toBe(false);
  });

  it("X8 a client with no replayInFlight wiring still clears loadingHistory on the empty terminal", () => {
    // Simulate the old client: no setReplayInFlight / timers ref supplied.
    const s = setup();
    s.setLoadingHistory((prev: Map<string, boolean>) => new Map(prev).set(SID, true));
    s.timersRef.current.set(SID, setTimeout(() => {}, 99999));

    expect(() => s.dispatch(batch(SID, [], true))).not.toThrow();

    expect(s.loadingHistoryRef.current.get(SID)).toBe(false);
    expect(s.timersRef.current.has(SID)).toBe(false);
  });

  it("P1 re-arm touches the timers ref only: no setReplayInFlight for batches 2..10", () => {
    const s = setup();
    armBoth(s, SID);
    s.dispatch(batch(SID, [1], false));
    const baseline = s.setReplayInFlight.mock.calls.length;

    for (let i = 2; i <= 10; i++) s.dispatch(batch(SID, [i], false));

    expect(s.setReplayInFlight.mock.calls.length - baseline).toBe(0);
  });
});
