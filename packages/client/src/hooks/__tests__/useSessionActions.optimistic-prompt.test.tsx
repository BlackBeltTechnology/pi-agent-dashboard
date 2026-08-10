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
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";

function setup(selectedId: string | undefined, states: Map<string, SessionState>) {
  let sessionStates = states;
  const setSessionStates = vi.fn((updater: any) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
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

  it("handleSendPromptToSession does NOT write pendingPrompt for a streaming target", () => {
    const states = new Map([["s2", streaming()]]);
    const { actions, getStates } = setup(undefined, states);

    actions.handleSendPromptToSession("s2", "quick hello");

    expect(getStates().get("s2")!.pendingPrompt).toBeUndefined();
  });
});
