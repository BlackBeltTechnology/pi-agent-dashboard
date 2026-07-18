import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { foldLiveEvents } from "../../lib/chat/coalesce-live-events.js";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import {
  applySessionMessage,
  createSessionAccumulator,
  useSessionState,
} from "../useSessionState.js";

const SID = "s1";

function ev(eventType: string, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: 1, data };
}
function liveMsg(seq: number, event: DashboardEvent): ServerToBrowserMessage {
  return { type: "event", sessionId: SID, seq, event } as ServerToBrowserMessage;
}
function replayMsg(
  events: Array<{ seq: number; event: DashboardEvent }>,
  isLast = true,
): ServerToBrowserMessage {
  return { type: "event_replay", sessionId: SID, events, isLast } as ServerToBrowserMessage;
}

describe("applySessionMessage (pure reducer)", () => {
  it("folds a live `event` with isLive semantics, matching foldLiveEvents", () => {
    const acc0 = createSessionAccumulator();
    const acc1 = applySessionMessage(acc0, liveMsg(1, ev("agent_start")));
    const expected = foldLiveEvents(createInitialState(), [{ seq: 1, event: ev("agent_start") }]);
    expect(acc1.state.isStreaming).toBe(expected.state.isStreaming);
    expect(acc1.state.isStreaming).toBe(true);
    expect(acc1.maxSeq).toBe(1);
  });

  it("event_replay with firstSeq===1 resets before folding and carries pendingPrompt", () => {
    // Seed a dirty accumulator with prior state + a pendingPrompt + a high maxSeq.
    // Fold benign (non-clearing) events so the carried pendingPrompt is observable
    // — `agent_start`/`agent_end` would themselves clear it (faithful to the driver).
    const dirty: SessionState = {
      ...createInitialState(),
      isStreaming: true,
      pendingPrompt: { text: "hi", status: "sending" },
    };
    const acc = { state: dirty, maxSeq: 9 };
    const out = applySessionMessage(
      acc,
      replayMsg([{ seq: 1, event: ev("__noop_test_event__") }]),
    );
    // Reset happened: prior isStreaming:true was cleared by createInitialState().
    expect(out.state.isStreaming).toBe(false);
    // The carried pendingPrompt survives a non-clearing replay event.
    expect(out.state.pendingPrompt).toEqual({ text: "hi", status: "sending" });
    expect(out.maxSeq).toBe(1);
  });

  it("event_replay whose firstSeq <= maxSeq resets (re-replay reconciliation, Doubt B2)", () => {
    const acc = { state: { ...createInitialState(), isStreaming: true }, maxSeq: 10 };
    const out = applySessionMessage(acc, replayMsg([{ seq: 5, event: ev("agent_start") }]));
    // firstSeq(5) <= maxSeq(10) → reset, then fold → isStreaming true from agent_start.
    expect(out.maxSeq).toBe(5);
    expect(out.state.isStreaming).toBe(true);
  });

  it("event_replay delta (firstSeq > maxSeq) appends without resetting", () => {
    const acc = { state: { ...createInitialState(), isStreaming: true }, maxSeq: 3 };
    const out = applySessionMessage(acc, replayMsg([{ seq: 4, event: ev("agent_end", { messages: [] }) }]));
    // No reset: agent_end folds onto the existing streaming state → isStreaming false.
    expect(out.state.isStreaming).toBe(false);
    expect(out.maxSeq).toBe(4);
  });

  it("extension_ui_request adds an interactive request; ui_dismiss removes it", () => {
    const acc0 = createSessionAccumulator();
    const added = applySessionMessage(acc0, {
      type: "extension_ui_request",
      sessionId: SID,
      requestId: "r1",
      method: "confirm",
      params: { title: "OK?" },
    } as ServerToBrowserMessage);
    expect(added.state.interactiveRequests.map((r) => r.requestId)).toContain("r1");
    const dismissed = applySessionMessage(added, {
      type: "ui_dismiss",
      sessionId: SID,
      requestId: "r1",
    } as ServerToBrowserMessage);
    expect(dismissed.state.interactiveRequests.find((r) => r.requestId === "r1")?.status).not.toBe(
      "pending",
    );
  });

  it("prompt_request adds a PromptBus request; prompt_dismiss removes it", () => {
    const acc0 = createSessionAccumulator();
    const added = applySessionMessage(acc0, {
      type: "prompt_request",
      sessionId: SID,
      promptId: "p1",
      prompt: { question: "Pick", type: "select", options: ["a", "b"] },
      component: { type: "select", props: {} },
      placement: "inline",
    } as ServerToBrowserMessage);
    expect(added.state.interactiveRequests.map((r) => r.requestId)).toContain("p1");
    const dismissed = applySessionMessage(added, {
      type: "prompt_dismiss",
      sessionId: SID,
      promptId: "p1",
    } as ServerToBrowserMessage);
    expect(dismissed.state.interactiveRequests.find((r) => r.requestId === "p1")?.status).not.toBe(
      "pending",
    );
  });

  it("prompt_received routes to applyPromptReceived (fresh=false drops pendingPrompt)", () => {
    const acc = {
      state: { ...createInitialState(), pendingPrompt: { text: "q", status: "sending" as const } },
      maxSeq: 0,
    };
    const out = applySessionMessage(acc, {
      type: "prompt_received",
      sessionId: SID,
      fresh: false,
    } as ServerToBrowserMessage);
    expect(out.state.pendingPrompt).toBeUndefined();
  });

  it("session_state_reset clears state but carries pendingPrompt and zeroes maxSeq", () => {
    const acc = {
      state: {
        ...createInitialState(),
        isStreaming: true,
        pendingPrompt: { text: "carry", status: "sending" as const },
      },
      maxSeq: 7,
    };
    const out = applySessionMessage(acc, {
      type: "session_state_reset",
      sessionId: SID,
    } as ServerToBrowserMessage);
    expect(out.state.isStreaming).toBe(false);
    expect(out.state.pendingPrompt).toEqual({ text: "carry", status: "sending" });
    expect(out.maxSeq).toBe(0);
  });

  it("asset_register is a no-op for SessionState (returns same accumulator)", () => {
    const acc = createSessionAccumulator();
    const out = applySessionMessage(acc, {
      type: "asset_register",
      sessionId: SID,
      hash: "h",
      data: "d",
      mimeType: "image/png",
    } as ServerToBrowserMessage);
    expect(out).toBe(acc);
  });
});

describe("useSessionState (imperative hook)", () => {
  it("apply() folds messages into the returned state", () => {
    const { result } = renderHook(() => useSessionState());
    act(() => result.current.apply(liveMsg(1, ev("agent_start"))));
    expect(result.current.state.isStreaming).toBe(true);
    act(() => result.current.apply(liveMsg(2, ev("agent_end", { messages: [] }))));
    expect(result.current.state.isStreaming).toBe(false);
  });

  it("filters messages by sessionId when provided", () => {
    const { result } = renderHook(() => useSessionState(SID));
    act(() =>
      result.current.apply({
        type: "event",
        sessionId: "other",
        seq: 1,
        event: ev("agent_start"),
      } as ServerToBrowserMessage),
    );
    expect(result.current.state.isStreaming).toBe(false);
    act(() => result.current.apply(liveMsg(1, ev("agent_start"))));
    expect(result.current.state.isStreaming).toBe(true);
  });

  it("reset() returns to the initial state", () => {
    const { result } = renderHook(() => useSessionState());
    act(() => result.current.apply(liveMsg(1, ev("agent_start"))));
    expect(result.current.state.isStreaming).toBe(true);
    act(() => result.current.reset());
    expect(result.current.state.isStreaming).toBe(false);
    expect(result.current.state.messages).toEqual([]);
  });
});
