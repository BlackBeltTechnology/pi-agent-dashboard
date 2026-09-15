/**
 * Honest delivery of user intent, client side.
 * See change: stop-discarding-known-session-state (test-plan F5/F6/F8).
 *
 * A prompt `send` refused at call time (`rejected` verdict) SHALL be marked
 * failed immediately — attributed to the dashboard connection — with no 30 s
 * wait and no safety timer. A handed/queued prompt keeps the existing
 * genuinely-unknown path (timer + "may not have been received").
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyPromptTimeout, createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { useSessionActions } from "../useSessionActions.js";
import type { SendVerdict } from "../useWebSocket.js";

function setup(selectedId: string | undefined, states: Map<string, SessionState>, verdict?: SendVerdict, sessionsMap: Map<string, any> = new Map()) {
  let sessionStates = states;
  const sessionStatesRef = { current: sessionStates };
  const setSessionStates = vi.fn((updater: any) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
    sessionStatesRef.current = sessionStates;
  });
  const send = vi.fn(() => verdict);
  const deps: any = {
    selectedId,
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions: sessionsMap,
    setSessions: vi.fn(),
    setSessionStates,
    sessionStatesRef,
    setSpawningCwds: vi.fn(),
    setTerminals: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawnTimeoutsRef: { current: new Map() },
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef: { current: new Map() },
  };
  const { result } = renderHook(() => useSessionActions(deps));
  return { actions: result.current, send, getStates: () => sessionStates };
}

function idle(): SessionState {
  return { ...createInitialState(), status: "idle", isStreaming: false };
}

describe("useSessionActions — delivery verdict", () => {
  it("F5: a rejected prompt is marked failed immediately with a connection cause", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, getStates } = setup("s1", states, { status: "rejected", reason: "no_socket" });

    actions.handleSend("run the tests");

    const pending = getStates().get("s1")!.pendingPrompt!;
    expect(pending.status).toBe("failed");
    expect(pending.failureCause).toBe("connection");
    // Text preserved so the user can retry.
    expect(pending.text).toBe("run the tests");
  });

  it("F6: a known-undelivered prompt never enters the `sending` arm (timer not armed)", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, getStates } = setup("s1", states, { status: "rejected", reason: "send_failed" });

    actions.handleSend("run the tests");

    // App arms `usePendingPromptTimeout` only on `status === "sending"`.
    expect(getStates().get("s1")!.pendingPrompt!.status).not.toBe("sending");
  });

  it("F5: quick-send to a rejected target is also marked failed immediately", () => {
    const states = new Map([["s2", idle()]]);
    const { actions, getStates } = setup(undefined, states, { status: "rejected", reason: "no_socket" });

    actions.handleSendPromptToSession("s2", "quick hello");

    const pending = getStates().get("s2")!.pendingPrompt!;
    expect(pending.status).toBe("failed");
    expect(pending.failureCause).toBe("connection");
  });

  it("2.3a: a prompt to an ended session with no session file fails immediately with `no_session_file` and is never sent", () => {
    const states = new Map([["s1", idle()]]);
    const sessionsMap = new Map([["s1", { id: "s1", status: "ended", sessionFile: null }]]);
    const { actions, send, getStates } = setup("s1", states, { status: "handed" }, sessionsMap);

    actions.handleSend("continue where you left off");

    // The server would refuse it; the browser must not pretend it was sent.
    expect(send).not.toHaveBeenCalled();
    const pending = getStates().get("s1")!.pendingPrompt!;
    expect(pending.status).toBe("failed");
    expect(pending.failureCause).toBe("no_session_file");
  });

  it("F8: a handed prompt keeps the genuinely-unknown path (sending, then untouched 30s wording)", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, getStates } = setup("s1", states, { status: "handed" });

    actions.handleSend("run the tests");
    expect(getStates().get("s1")!.pendingPrompt!.status).toBe("sending");
    expect(getStates().get("s1")!.pendingPrompt!.failureCause).toBeUndefined();

    const settled = applyPromptTimeout(
      getStates().get("s1")!,
      "No response from session — the prompt may not have been received.",
    );
    expect(settled.pendingPrompt!.status).toBe("failed");
    expect(settled.pendingPrompt!.failureCause).toBeUndefined();
    expect(settled.lastError!.message).toBe(
      "No response from session — the prompt may not have been received.",
    );
  });

  it("F8: a queued prompt also keeps the unknown path (it may still flush)", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, getStates } = setup("s1", states, { status: "queued", entryId: 1 });

    actions.handleSend("run the tests");

    expect(getStates().get("s1")!.pendingPrompt!.status).toBe("sending");
    expect(getStates().get("s1")!.pendingPrompt!.failureCause).toBeUndefined();
  });

  it("Q1: a queued prompt that is dropped undelivered becomes an honest connection failure", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, getStates } = setup("s1", states, { status: "queued", entryId: 7 });

    actions.handleSend("run the tests");
    expect(getStates().get("s1")!.pendingPrompt!.status).toBe("sending");

    // The outbox reports the drop after the reconnect window elapsed.
    actions.markPromptUndelivered("s1", 7);

    const pending = getStates().get("s1")!.pendingPrompt!;
    expect(pending.status).toBe("failed");
    expect(pending.failureCause).toBe("connection");
    expect(pending.text).toBe("run the tests"); // preserved for Retry
  });

  it("Q1: a drop report for a SUPERSEDED entry never fails the current bubble (identical text)", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, send, getStates } = setup("s1", states, { status: "queued", entryId: 1 });
    // Two sends, IDENTICAL text, DIFFERENT outbox entries.
    send.mockReturnValueOnce({ status: "queued", entryId: 1 });
    send.mockReturnValueOnce({ status: "queued", entryId: 2 });

    actions.handleSend("same text");
    actions.handleSend("same text");

    // Entry 1's expiry must not mark the bubble that now represents entry 2 —
    // entry 2 can still flush, and failing it would invite a duplicate retry.
    actions.markPromptUndelivered("s1", 1);
    expect(getStates().get("s1")!.pendingPrompt!.status).toBe("sending");
    expect(getStates().get("s1")!.pendingPrompt!.queueId).toBe(2);

    // Entry 2's own expiry does.
    actions.markPromptUndelivered("s1", 2);
    expect(getStates().get("s1")!.pendingPrompt!.status).toBe("failed");
  });
});
