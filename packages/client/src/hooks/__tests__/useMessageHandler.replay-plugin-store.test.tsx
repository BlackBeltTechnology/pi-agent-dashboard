/**
 * Regression suite for change: replay-persisted-flow-runs (section 5).
 *
 * Pin: the `event_replay` cold-load path MUST mirror the replayed batch
 * into the plugin-runtime per-session event store (`publishSessionEvents`),
 * not only into the shell reducer. The flow card derives `flowState` solely
 * from `useSessionEvents` → `reduceFlowsSessionState`; if replay does not
 * feed that store, the slot never reattaches on `/resume`/refresh/restart.
 *
 * Reuses the shell's `shouldReset` so a full re-replay clears the store
 * before republishing (no duplicates) while a continuation batch appends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import { type SessionState } from "../../lib/chat/event-reducer.js";
import { getSessionEvents, clearSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime";
import { reduceFlowsSessionState } from "@blackbelt-technology/pi-dashboard-flows-plugin/client";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function flowStarted(): DashboardEvent {
  return {
    eventType: "flow_started",
    timestamp: 100,
    data: {
      flowName: "test",
      task: "",
      steps: [{ id: "research", stepType: "agent", agent: "demo-researcher", blockedBy: [] }],
    },
  } as unknown as DashboardEvent;
}

function flowToolCall(): DashboardEvent {
  return {
    eventType: "flow_tool_call",
    timestamp: 200,
    data: { agentName: "demo-researcher", stepId: "research", toolName: "bash", input: { command: "ls" } },
  } as unknown as DashboardEvent;
}

function setup() {
  const sessionStatesRef = { current: new Map<string, SessionState>() };
  const maxSeqMap = new Map<string, number>();
  const setSessionStates = vi.fn((updater: any) => {
    sessionStatesRef.current =
      typeof updater === "function" ? updater(sessionStatesRef.current) : updater;
  });
  const setters: any = {
    setSessions: vi.fn(), setSessionStates, setSessionCommands: vi.fn(), setSessionFlows: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setModelsMap: vi.fn(), setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(), setPinnedDirectories: vi.fn(),
    setFavoriteModels: vi.fn(), setTerminals: vi.fn(), setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setLoadingHistory: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: maxSeqMap }, selectedSessionIdRef: { current: undefined },
    loadingHistoryTimersRef: { current: new Map() },
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (msg: ServerToBrowserMessage) => result.current(msg) };
}

function replayMsg(sid: string, seqStart: number, events: DashboardEvent[]): ServerToBrowserMessage {
  return {
    type: "event_replay",
    sessionId: sid,
    events: events.map((event, i) => ({ seq: seqStart + i, event })),
  } as ServerToBrowserMessage;
}

let counter = 0;
const freshSid = () => `replay-plugin-store-${counter++}`;

describe("useMessageHandler event_replay → plugin event-store", () => {
  beforeEach(() => {
    // distinct sid per test isolates the module-level store; clear defensively
    clearSessionEvents(`replay-plugin-store-${counter}`);
  });

  it("mirrors replayed flow events into the plugin store and rebuilds flowState", () => {
    const { dispatch } = setup();
    const sid = freshSid();

    dispatch(replayMsg(sid, 1, [flowStarted(), flowToolCall()]));

    const events = getSessionEvents(sid);
    expect(events.map((e) => e.eventType)).toEqual(["flow_started", "flow_tool_call"]);

    const { flowState } = reduceFlowsSessionState(events);
    expect(flowState).not.toBeNull();
    expect(flowState!.agents.size).toBeGreaterThanOrEqual(1);
  });

  it("re-replay (full sweep) does NOT duplicate events in the plugin store", () => {
    const { dispatch } = setup();
    const sid = freshSid();
    const batch = [flowStarted(), flowToolCall()];

    dispatch(replayMsg(sid, 1, batch));
    expect(getSessionEvents(sid)).toHaveLength(2);

    // reconnect re-replay, firstSeq=1 → shouldReset → clear before republish
    dispatch(replayMsg(sid, 1, batch));
    expect(getSessionEvents(sid)).toHaveLength(2);
  });

  it("continuation batch (firstSeq > maxSeq) appends without clearing", () => {
    const { dispatch } = setup();
    const sid = freshSid();

    dispatch(replayMsg(sid, 1, [flowStarted(), flowToolCall()]));
    expect(getSessionEvents(sid)).toHaveLength(2);

    // tail batch, strictly newer seq → append, no reset
    dispatch(replayMsg(sid, 3, [flowToolCall()]));
    expect(getSessionEvents(sid)).toHaveLength(3);
  });
});
