/**
 * Tests for the idle-scoped optimistic `pendingPrompt` write.
 * See change: optimistic-prompt-progress.
 *
 * `handleSend` and `handleSendPromptToSession` SHALL set
 * `pendingPrompt { status: "sending" }` only when the target session is NOT
 * mid-turn at send time. Mid-turn sends are governed by `mid-turn-prompt-queue`
 * and SHALL NOT write `pendingPrompt`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionActions } from "../useSessionActions.js";
import { applyPromptTimeout, createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";

function setup(selectedId: string | undefined, states: Map<string, SessionState>) {
  let sessionStates = states;
  const sessionStatesRef = { current: sessionStates };
  const setSessionStates = vi.fn((updater: any) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
    sessionStatesRef.current = sessionStates;
  });
  const send = vi.fn();
  const deps: any = {
    selectedId,
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions: new Map(),
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
  return { actions: result.current, send, getStates: () => sessionStates, sessionStatesRef };
}

function idle(): SessionState {
  return { ...createInitialState(), status: "idle", isStreaming: false };
}
function streaming(): SessionState {
  return { ...createInitialState(), status: "streaming", isStreaming: true };
}

describe("useSessionActions — idle-scoped optimistic pendingPrompt", () => {
  it("handleSend on an idle session writes pendingPrompt{status:sending}", () => {
    const states = new Map([["s1", idle()]]);
    const { actions, send, getStates } = setup("s1", states);

    actions.handleSend("run the tests");

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "send_prompt", sessionId: "s1", text: "run the tests" }));
    expect(getStates().get("s1")!.pendingPrompt).toEqual({ text: "run the tests", images: undefined, delivery: undefined, status: "sending" });
  });

  it("handleSend writes pendingPrompt when the session has no state entry yet (fresh idle session)", () => {
    const states = new Map<string, SessionState>(); // no entry for s1 yet
    const { actions, getStates } = setup("s1", states);

    actions.handleSend("hi");

    expect(getStates().get("s1")?.pendingPrompt).toMatchObject({ text: "hi", status: "sending" });
  });

  it("handleSend on a mid-turn (streaming) session does NOT write pendingPrompt", () => {
    const states = new Map([["s1", streaming()]]);
    const { actions, send, getStates } = setup("s1", states);

    actions.handleSend("steer me", undefined, "steer");

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "send_prompt", sessionId: "s1", delivery: "steer" }));
    expect(getStates().get("s1")!.pendingPrompt).toBeUndefined();
  });

  it("handleSendPromptToSession (quick-send) writes pendingPrompt for an idle target", () => {
    const states = new Map([["s2", idle()]]);
    const { actions, send, getStates } = setup(undefined, states);

    actions.handleSendPromptToSession("s2", "quick hello");

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "send_prompt", sessionId: "s2", text: "quick hello" }));
    expect(getStates().get("s2")!.pendingPrompt).toEqual({ text: "quick hello", images: undefined, status: "sending" });
  });

  it("#X4 handleSendPromptToSession does NOT write pendingPrompt for a streaming target", () => {
    const states = new Map([["s2", streaming()]]);
    const { actions, getStates } = setup(undefined, states);

    actions.handleSendPromptToSession("s2", "quick hello");

    expect(getStates().get("s2")!.pendingPrompt).toBeUndefined();
  });

  // The card quick-send targets a session this browser is not subscribed to, so
  // neither the ack nor `message_start` can reach it — the safety timeout is its
  // ONLY settlement, and it must land on a visible failed bubble (text kept),
  // never a silent drop or a permanently-disabled composer.
  // See change: fix-optimistic-prompt-stuck-sending, test-plan #X3.
  it("#X3 an unackable quick-send settles into a visible failed bubble on timeout", () => {
    const states = new Map([["s2", idle()]]);
    const { actions, getStates } = setup(undefined, states);

    actions.handleSendPromptToSession("s2", "quick hello");
    expect(getStates().get("s2")!.pendingPrompt!.status).toBe("sending");

    // No ack / message_start is reachable for this session; the 30s safety
    // timeout is what settles it.
    const settled = applyPromptTimeout(getStates().get("s2")!, "no response");

    expect(settled.pendingPrompt).toEqual({ text: "quick hello", images: undefined, status: "failed" });
    expect(settled.lastError?.message).toBe("no response");
  });
});

describe("useSessionActions — settled provider Retry", () => {
  // test-plan #1: the settled-error Retry is dispatched as a first-class
  // retry_session protocol message, NEVER the legacy /__dashboard_retry
  // send_prompt sentinel. See change:
  // replace-dashboard-retry-command-with-protocol-message.
  it("#1 dispatches retry_session (not the sentinel) without replaying a user prompt or changing messages", () => {
    const state = idle();
    state.lastError = { message: "503 overloaded", timestamp: 1 };
    const states = new Map([["s1", state]]);
    const beforeMessages = states.get("s1")!.messages;
    const { actions, send, getStates } = setup("s1", states);

    actions.handleRetrySession("s1");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "retry_session", sessionId: "s1" });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "send_prompt", text: "/__dashboard_retry" }),
    );
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ text: "503 overloaded" }));
    expect(getStates().get("s1")!.messages).toBe(beforeMessages);
    expect(getStates().get("s1")!.retryState).toBeUndefined();
  });

  // test-plan #2: decision table over the 4 guard flags. Exactly one eligible
  // baseline dispatches; every ineligible state dispatches zero.
  it("#2 stale-click guard blocks retry_session in every ineligible state", () => {
    const withLastError = (over: Partial<SessionState>): SessionState => ({
      ...idle(),
      lastError: { message: "503 overloaded", timestamp: 1 },
      ...over,
    });
    const cases: Array<{ name: string; state: SessionState }> = [
      { name: "lastError absent", state: { ...idle(), lastError: undefined } },
      { name: "retryState set", state: withLastError({ retryState: { attempt: 1, maxAttempts: 3, startedAt: 0, waiting: false, delayMs: 0 } as any }) },
      { name: "retryCancelled true", state: withLastError({ retryCancelled: true }) },
      { name: "isStreaming true", state: withLastError({ isStreaming: true }) },
    ];
    for (const c of cases) {
      const { actions, send } = setup("s1", new Map([["s1", c.state]]));
      actions.handleRetrySession("s1");
      expect(send, `ineligible: ${c.name}`).not.toHaveBeenCalled();
    }
    // Eligible baseline: exactly one dispatch.
    const { actions, send } = setup("s1", new Map([["s1", withLastError({})]]));
    actions.handleRetrySession("s1");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "retry_session", sessionId: "s1" });
  });

  it("drops a stale Retry callback after the lifecycle has already recovered", () => {
    const state = idle();
    state.lastError = { message: "503 overloaded", timestamp: 1 };
    const { actions, send, sessionStatesRef } = setup("s1", new Map([["s1", state]]));

    sessionStatesRef.current = new Map([["s1", idle()]]);
    actions.handleRetrySession("s1");

    expect(send).not.toHaveBeenCalled();
  });
});
