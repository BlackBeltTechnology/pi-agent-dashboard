/**
 * Regression tests for: optimistic `pendingPrompt` survives client-side
 * `session_state_reset` and `event_replay` (shouldReset branch).
 *
 * See change: preserve-pending-prompt-across-replay.
 *
 * The dispatch returned by `useMessageHandler` is a `useCallback` over a
 * pure switch on `msg.type` — we render the hook with stub setters and
 * inspect the state map(s) the dispatch mutates.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMessageHandler, type MessageHandlerSetters, type MessageHandlerDeps } from "../hooks/useMessageHandler.js";
import { createInitialState, type SessionState } from "../lib/event-reducer.js";

function makeRefs() {
  return {
    spawningCwdsRef: { current: new Set<string>() },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map<string, { cwd: string; kind: "spawn" | "resume" }>() },
    loadingHistoryTimersRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
  } satisfies Pick<
    MessageHandlerDeps,
    "spawningCwdsRef" | "subscribedRef" | "pendingTerminalCwdRef" | "lastCreatedTerminalIdRef" | "maxSeqMapRef" | "selectedSessionIdRef" | "pendingSpawnsRef" | "loadingHistoryTimersRef"
  >;
}

function makeHarness(initialState: Map<string, SessionState>) {
  let sessionStates = initialState;
  const setSessionStates = ((updater: any) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
  }) as React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;

  // All other setters are no-ops — the cases under test only touch sessionStates.
  const noop = ((_: any) => {}) as any;
  const setters: MessageHandlerSetters = {
    setSessions: noop,
    setSessionStates,
    setSessionCommands: noop,
    setFileResults: noop,
    setOpenspecMap: noop,
    setFolderGitMap: noop,
    setOpenspecGroupsMap: noop,
    setModelsMap: noop,
    setRolesMap: noop,
    setSpawnResult: noop,
    setSessionOrderMap: noop,
    setPinnedDirectories: noop, setFavoriteModels: noop,
    setWorkspaces: noop,
    setTerminals: noop,
    setEditorStatuses: noop,
    setDiscoveredServers: noop,
    setSpawnErrors: noop,
    setResumeErrors: noop,
    setDisplayPrefs: noop,
    setViewMessagesMap: noop,
    setLoadingHistory: noop,
  };

  const deps: MessageHandlerDeps = {
    send: () => {},
    navigate: () => {},
    clearSpawningCwd: () => {},
    ...makeRefs(),
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (msg: any) => act(() => result.current(msg)),
    getStates: () => sessionStates,
  };
}

const SID = "session-abc";

function stateWithPendingPrompt(): SessionState {
  const s = createInitialState();
  s.pendingPrompt = { text: "hello", images: undefined };
  // Mutate a couple of other fields to confirm they ARE reset (regression
  // guard: we must not silently expand the carry-over set).
  (s as any).streamingText = "leftover stream";
  return s;
}

describe("useMessageHandler — pendingPrompt across reset/replay", () => {
  it("session_state_reset preserves pendingPrompt and resets other state", () => {
    const initial = new Map<string, SessionState>([[SID, stateWithPendingPrompt()]]);
    const { dispatch, getStates } = makeHarness(initial);

    dispatch({ type: "session_state_reset", sessionId: SID });

    const after = getStates().get(SID)!;
    expect(after.pendingPrompt).toEqual({ text: "hello", images: undefined });
    // Other fields wiped to defaults.
    expect(after.streamingText).toBe(createInitialState().streamingText);
    expect(after.messages).toEqual(createInitialState().messages);
  });

  it("event_replay (shouldReset, firstSeq===1) preserves pendingPrompt across the reset", () => {
    const initial = new Map<string, SessionState>([[SID, stateWithPendingPrompt()]]);
    const { dispatch, getStates } = makeHarness(initial);

    // Empty replay batch with firstSeq===1 would also work, but pass at least
    // one event so reduce-on-top is exercised. Use a no-op-ish event the
    // reducer accepts; an unknown type is a pass-through in the reducer
    // default branch.
    dispatch({
      type: "event_replay",
      sessionId: SID,
      events: [{ seq: 1, event: { eventType: "noop_for_test", timestamp: 0, data: {} } as any }],
      isLast: true,
    });

    const after = getStates().get(SID)!;
    expect(after.pendingPrompt).toEqual({ text: "hello", images: undefined });
  });

  it("event_replay (no reset, firstSeq>maxSeq) does not touch pendingPrompt", () => {
    const initial = new Map<string, SessionState>([[SID, stateWithPendingPrompt()]]);
    const { dispatch, getStates } = makeHarness(initial);

    // firstSeq > current maxSeq (which starts at 0) → shouldReset === false.
    dispatch({
      type: "event_replay",
      sessionId: SID,
      events: [{ seq: 5, event: { eventType: "noop_for_test", timestamp: 0, data: {} } as any }],
      isLast: true,
    });

    const after = getStates().get(SID)!;
    expect(after.pendingPrompt).toEqual({ text: "hello", images: undefined });
  });
});
