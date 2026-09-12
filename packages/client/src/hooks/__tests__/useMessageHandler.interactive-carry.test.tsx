/**
 * E12 (test-plan #E12) for change: fix-pending-prompt-lost-on-replay.
 *
 * The `useMessageHandler` reset arms — `event_replay` (full-sweep reset) and
 * `session_state_reset` — must carry UNANSWERED interactive requests and their
 * paired `ui-<requestId>` rows across the rebuild (design D8). Harness mirrors
 * `useMessageHandler.replay-reset.test.tsx`.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import { useMessageHandler } from "../useMessageHandler.js";

const SID = "session-1";

function makeStartEvt(toolCallId: string, ts: number): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: ts,
    data: { toolCallId, toolName: "bash", args: { command: `cmd-${toolCallId}` } },
  };
}

function promptRequestMsg(promptId: string): ServerToBrowserMessage {
  return {
    type: "prompt_request",
    sessionId: SID,
    promptId,
    prompt: { question: "Pick", type: "select", options: ["a", "b"] },
    component: { type: "select", props: {} },
    placement: "inline",
  } as ServerToBrowserMessage;
}

function replayMsg(seqStart: number, events: DashboardEvent[]): ServerToBrowserMessage {
  return {
    type: "event_replay",
    sessionId: SID,
    events: events.map((event, i) => ({ seq: seqStart + i, event })),
  } as ServerToBrowserMessage;
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
    setPinnedDirectories: vi.fn(),
    setFavoriteModels: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
    setLoadingHistory: vi.fn(),
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
    maxSeqMapRef: { current: maxSeqMap },
    selectedSessionIdRef: { current: undefined },
    loadingHistoryTimersRef: { current: new Map() },
    replayInFlightTimersRef: { current: new Map() },
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);

  return { dispatch, sessionStatesRef, maxSeqMap };
}

function uiRows(state: SessionState | undefined, id: string) {
  return (state?.messages ?? []).filter((m) => m.id === id);
}

describe("useMessageHandler interactive-request carry (design D8)", () => {
  it("E12 site 1: event_replay full reset carries the pending request AND its ui row", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(promptRequestMsg("p1"));
    expect(sessionStatesRef.current.get(SID)?.interactiveRequests).toHaveLength(1);

    dispatch(replayMsg(1, [makeStartEvt("t1", 100)]));

    const state = sessionStatesRef.current.get(SID);
    expect(state?.interactiveRequests.map((r) => r.requestId)).toEqual(["p1"]);
    expect(state?.interactiveRequests[0].status).toBe("pending");
    // Both halves: exactly one `ui-p1` row, no duplicate.
    expect(uiRows(state, "ui-p1")).toHaveLength(1);
    // The replayed tool card is rebuilt alongside the carried row.
    expect(state?.messages.filter((m) => m.role === "toolResult")).toHaveLength(1);
  });

  it("E12 site 1: multi-batch replay — the carried row is not duplicated by batch 2", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(promptRequestMsg("p1"));
    dispatch(replayMsg(1, [makeStartEvt("t1", 100)]));

    // Continuation batch (firstSeq > maxSeq → delta, no reset). It folds a
    // transcript row AFTER the carried dialog — without the re-tail the dialog
    // is buried mid-transcript (and, virtualized, off-screen) while its
    // `interactiveRequests` entry keeps the desync detector suppressed.
    dispatch(replayMsg(2, [makeStartEvt("t2", 200)]));

    const state = sessionStatesRef.current.get(SID);
    expect(uiRows(state, "ui-p1")).toHaveLength(1);
    expect(state?.interactiveRequests).toHaveLength(1);
    // The live dialog must remain the LAST row after the whole sweep.
    expect(state?.messages[state.messages.length - 1]?.id).toBe("ui-p1");
  });

  it("E12 site 2: session_state_reset carries the pending request AND its ui row", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(promptRequestMsg("p1"));

    dispatch({ type: "session_state_reset", sessionId: SID } as ServerToBrowserMessage);

    const state = sessionStatesRef.current.get(SID);
    expect(state?.interactiveRequests.map((r) => r.requestId)).toEqual(["p1"]);
    expect(uiRows(state, "ui-p1")).toHaveLength(1);
  });

  it("E11 site: an answered request is NOT carried across session_state_reset", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(promptRequestMsg("p1"));
    dispatch({
      type: "prompt_dismiss",
      sessionId: SID,
      promptId: "p1",
    } as ServerToBrowserMessage);

    dispatch({ type: "session_state_reset", sessionId: SID } as ServerToBrowserMessage);

    const state = sessionStatesRef.current.get(SID);
    expect(state?.interactiveRequests.filter((r) => r.status === "pending")).toEqual([]);
    expect(uiRows(state, "ui-p1")).toHaveLength(0);
  });
});
