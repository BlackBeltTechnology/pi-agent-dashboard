/**
 * A notify is a render-only chat row: both reducers must append an
 * `interactiveUi` row to `messages` and NEVER an `interactiveRequests` entry
 * (that list is where the "user is blocked" semantics live).
 *
 * Covers test-plan #F1 (main-app reducer), #F2 (embed reducer), #E9 (dedup by
 * notifyId, not message text).
 *
 * See change: split-notify-from-prompt-request.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type MessageHandlerDeps, type MessageHandlerSetters, useMessageHandler } from "../hooks/useMessageHandler.js";
import { useSessionState } from "../hooks/useSessionState.js";
import { createInitialState, type SessionState } from "../lib/chat/event-reducer.js";

const SID = "session-abc";

function makeMainAppHarness() {
  let sessionStates = new Map<string, SessionState>([[SID, createInitialState()]]);
  const setSessionStates = ((updater: any) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
  }) as React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;

  const noop = ((_: any) => {}) as any;
  const setters = new Proxy({ setSessionStates } as Partial<MessageHandlerSetters>, {
    get: (target, prop) => (prop in target ? (target as any)[prop] : noop),
  }) as MessageHandlerSetters;

  const deps: MessageHandlerDeps = {
    send: () => {},
    navigate: () => {},
    clearSpawningCwd: () => {},
    spawningCwdsRef: { current: new Set<string>() },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() },
    loadingHistoryTimersRef: { current: new Map() },
  } as MessageHandlerDeps;

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (msg: any) => act(() => result.current(msg)),
    get state() {
      return sessionStates.get(SID)!;
    },
  };
}

function notifyMsg(notifyId: string, message = "hello", level?: string) {
  return { type: "notify", sessionId: SID, notifyId, message, ...(level ? { level } : {}) } as any;
}

describe("notify reducer — chat row only, no pending request", () => {
  it("#F1 main-app reducer adds one interactiveUi row and no interactive request", () => {
    const h = makeMainAppHarness();

    h.dispatch(notifyMsg("n1", "hello", "success"));

    expect(h.state.interactiveRequests).toHaveLength(0);
    const rows = h.state.messages.filter((m) => m.role === "interactiveUi");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ui-n1");
    expect(rows[0].content).toBe("notify");
    expect((rows[0].args as any).params).toEqual({ message: "hello", level: "success" });
  });

  it("#F2 embed session-state reducer holds the same invariant", () => {
    const { result } = renderHook(() => useSessionState(SID));

    act(() => result.current.apply(notifyMsg("n1")));

    expect(result.current.state.interactiveRequests).toHaveLength(0);
    expect(result.current.state.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(1);
  });

  it("#E9 dedups by notifyId, not by message text", () => {
    const h = makeMainAppHarness();

    h.dispatch(notifyMsg("n1", "same text"));
    h.dispatch(notifyMsg("n2", "same text"));

    expect(h.state.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(2);
    expect(h.state.interactiveRequests).toHaveLength(0);
  });

  it("a replayed notify with a known notifyId does not duplicate the row", () => {
    const h = makeMainAppHarness();

    h.dispatch(notifyMsg("n1"));
    h.dispatch(notifyMsg("n1"));

    expect(h.state.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(1);
  });
});
