/**
 * Spawn-time model/thinking on `spawn_session`, the minted requestId returned
 * to the caller, and the ended-session pick riding `send_prompt` /
 * `resume_session` (continue only). See change: redesign-directory-home-split.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionActions } from "../useSessionActions.js";

function setup(opts: { sessions?: Map<string, any>; pick?: { model?: string; thinkingLevel?: string } } = {}) {
  const send = vi.fn();
  const pendingSpawnsRef = { current: new Map<string, any>() };
  const deps: any = {
    selectedId: "s1",
    send,
    navigate: vi.fn(),
    setMobileOpen: vi.fn(),
    sessions: opts.sessions ?? new Map(),
    setSessions: vi.fn(),
    setSessionStates: vi.fn(),
    setSpawningCwds: vi.fn(),
    setTerminals: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawnTimeoutsRef: { current: new Map() },
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef,
    getResumePick: () => opts.pick,
  };
  const { result } = renderHook(() => useSessionActions(deps));
  return { actions: result.current, send, pendingSpawnsRef };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("handleSpawnSession model/thinking", () => {
  it("sends model + thinkingLevel and returns the requestId of the pending entry", () => {
    const { actions, send, pendingSpawnsRef } = setup();
    const id = actions.handleSpawnSession("/p", undefined, { initialPrompt: "hi", model: "a/b", thinkingLevel: "high" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spawn_session", cwd: "/p", initialPrompt: "hi", model: "a/b", thinkingLevel: "high", requestId: id }),
    );
    expect(pendingSpawnsRef.current.has(id)).toBe(true);
  });

  it("omits both fields when none were chosen", () => {
    const { actions, send } = setup();
    actions.handleSpawnSession("/p", undefined, { initialPrompt: "hi" });
    const msg = send.mock.calls[0]?.[0];
    expect(msg).not.toHaveProperty("model");
    expect(msg).not.toHaveProperty("thinkingLevel");
  });
});

describe("ended-session pick on resume", () => {
  const ended = new Map([["s1", { id: "s1", status: "ended", sessionFile: "/f.jsonl" }]]);
  const live = new Map([["s1", { id: "s1", status: "active" }]]);

  it("send_prompt to an ended session carries the pick", () => {
    const { actions, send } = setup({ sessions: ended, pick: { model: "a/b", thinkingLevel: "low" } });
    actions.handleSend("hi");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "send_prompt", model: "a/b", thinkingLevel: "low" }));
  });

  it("send_prompt to a live session carries no pick", () => {
    const { actions, send } = setup({ sessions: live, pick: { model: "a/b" } });
    actions.handleSend("hi");
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("model");
  });

  it("an ended send without a pick carries neither field", () => {
    const { actions, send } = setup({ sessions: ended });
    actions.handleSend("hi");
    const msg = send.mock.calls[0]?.[0];
    expect(msg).not.toHaveProperty("model");
    expect(msg).not.toHaveProperty("thinkingLevel");
  });

  it("resume_session continue carries the pick; fork does not", () => {
    const { actions, send } = setup({ sessions: ended, pick: { model: "a/b" } });
    actions.handleResumeSession("s1", "continue");
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: "resume_session", mode: "continue", model: "a/b" });
    actions.handleResumeSession("s1", "fork");
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty("model");
  });
});
