/**
 * Regression suite for change: fix-replay-duplicates-tool-and-flushed-rows.
 *
 * Pin the broader replay-reset trigger: when the server sends an
 * `event_replay` whose first event has `seq <= maxSeqMapRef.get(sid)`,
 * the client SHALL reset state to `createInitialState()` before reducing
 * the events. This handles paginated / lazy / multi-batch replay where a
 * reconnect's first batch may not start at `seq=1`.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import { createInitialState, type SessionState } from "../../lib/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function makeStartEvt(toolCallId: string, ts: number): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: ts,
    data: { toolCallId, toolName: "bash", args: { command: `cmd-${toolCallId}` } },
  };
}

function setup() {
  const sessionStatesRef = { current: new Map<string, SessionState>() };
  const maxSeqMap = new Map<string, number>();

  const setSessionStates = vi.fn((updater: any) => {
    if (typeof updater === "function") {
      sessionStatesRef.current = updater(sessionStatesRef.current);
    } else {
      sessionStatesRef.current = updater;
    }
  });

  const setters: any = {
    setSessions: vi.fn(),
    setSessionStates,
    setSessionCommands: vi.fn(),
    setSessionFlows: vi.fn(),
    setFileResults: vi.fn(),
    setOpenspecMap: vi.fn(),
    setModelsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
    setLoadingHistory: vi.fn(),
  };

  const deps: any = {
    send: vi.fn(),
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() },
    subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: maxSeqMap },
    selectedSessionIdRef: { current: undefined },
    loadingHistoryTimersRef: { current: new Map() },
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);

  return { dispatch, sessionStatesRef, maxSeqMap };
}

function replayMsg(sid: string, seqStart: number, events: DashboardEvent[]): ServerToBrowserMessage {
  return {
    type: "event_replay",
    sessionId: sid,
    events: events.map((event, i) => ({ seq: seqStart + i, event })),
  } as ServerToBrowserMessage;
}

describe("useMessageHandler event_replay reset trigger", () => {
  const SID = "session-1";

  it("first replay (firstSeq=1) resets state and reduces events", () => {
    const { dispatch, sessionStatesRef } = setup();
    const events = [makeStartEvt("t1", 100), makeStartEvt("t2", 200)];

    dispatch(replayMsg(SID, 1, events));

    const state = sessionStatesRef.current.get(SID);
    expect(state).toBeDefined();
    expect(state!.messages.filter((m) => m.role === "toolResult")).toHaveLength(2);
  });

  it("replaying the same firstSeq=1 batch twice does NOT double messages[]", () => {
    const { dispatch, sessionStatesRef } = setup();
    const events = [makeStartEvt("t1", 100), makeStartEvt("t2", 200)];

    dispatch(replayMsg(SID, 1, events));
    const lengthAfterFirst = sessionStatesRef.current.get(SID)!.messages.length;

    dispatch(replayMsg(SID, 1, events));
    const lengthAfterSecond = sessionStatesRef.current.get(SID)!.messages.length;

    expect(lengthAfterSecond).toBe(lengthAfterFirst);
  });

  it("re-replay starting mid-stream (firstSeq <= maxSeq) resets and reduces from scratch", () => {
    const { dispatch, sessionStatesRef } = setup();
    // First connection: full replay 1..3
    const events1to3 = [makeStartEvt("t1", 100), makeStartEvt("t2", 200), makeStartEvt("t3", 300)];
    dispatch(replayMsg(SID, 1, events1to3));
    expect(sessionStatesRef.current.get(SID)!.messages.filter((m) => m.role === "toolResult")).toHaveLength(3);

    // Reconnect: server sends a paginated re-replay starting at seq=2
    // (e.g. lazy first batch is events 2-3). client maxSeq is 3, firstSeq is
    // 2 → 2 <= 3, must reset.
    const events2to3 = [makeStartEvt("t2", 200), makeStartEvt("t3", 300)];
    dispatch(replayMsg(SID, 2, events2to3));

    const tools = sessionStatesRef.current.get(SID)!.messages.filter((m) => m.role === "toolResult");
    // After reset + reduce of 2 events, we expect exactly 2 tool rows
    // (NOT 3+2=5; reset must have wiped t1).
    expect(tools).toHaveLength(2);
    expect(tools.map((m) => m.toolCallId)).toEqual(["t2", "t3"]);
  });

  it("genuine tail extension (firstSeq > maxSeq) preserves state and appends", () => {
    const { dispatch, sessionStatesRef } = setup();
    const events1to2 = [makeStartEvt("t1", 100), makeStartEvt("t2", 200)];
    dispatch(replayMsg(SID, 1, events1to2));

    // Tail batch — strictly new events, no overlap
    const events3to4 = [makeStartEvt("t3", 300), makeStartEvt("t4", 400)];
    dispatch(replayMsg(SID, 3, events3to4));

    const tools = sessionStatesRef.current.get(SID)!.messages.filter((m) => m.role === "toolResult");
    expect(tools).toHaveLength(4);
    expect(tools.map((m) => m.toolCallId)).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("empty replay preserves state", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(replayMsg(SID, 1, [makeStartEvt("t1", 100)]));
    const before = sessionStatesRef.current.get(SID)!;

    dispatch({ type: "event_replay", sessionId: SID, events: [] } as any);
    const after = sessionStatesRef.current.get(SID)!;

    expect(after.messages.length).toBe(before.messages.length);
  });
});
