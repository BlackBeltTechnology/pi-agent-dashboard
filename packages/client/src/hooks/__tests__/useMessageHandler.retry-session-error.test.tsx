/**
 * Suite for change: replace-dashboard-retry-command-with-protocol-message.
 *
 * Pins the `retry_session_error` handling in useMessageHandler (test-plan #9,
 * reducer half): a toast is shown, and the session's `lastError.timestamp` is
 * re-stamped to a strictly-greater revision so the SessionBanner's one-shot
 * Retry re-enables. When the session has no `lastError`, the handler is a
 * no-op on state (nothing to re-enable) but still toasts.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { useMessageHandler } from "../useMessageHandler.js";

function setup(initial?: Map<string, SessionState>) {
  let states = initial ?? new Map<string, SessionState>();
  const setSessionStates = vi.fn((updater: any) => {
    states = typeof updater === "function" ? updater(states) : updater;
  });
  const showToast = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates, setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setModelsMap: vi.fn(),
    setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(), setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(), setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(), setLoadingHistory: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
    showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (m: ServerToBrowserMessage) => result.current(m),
    showToast,
    getStates: () => states,
  };
}

function settled(timestamp: number): SessionState {
  return { ...createInitialState(), lastError: { message: "503 overloaded", timestamp } };
}

describe("useMessageHandler retry_session_error", () => {
  it("re-stamps lastError.timestamp to a strictly-greater revision and toasts", () => {
    const prev = 100;
    const { dispatch, showToast, getStates } = setup(new Map([["s1", settled(prev)]]));

    dispatch({ type: "retry_session_error", sessionId: "s1", error: "no reachable bridge" } as ServerToBrowserMessage);

    const next = getStates().get("s1")!;
    // Revision strictly advances (re-enables the one-shot Retry) …
    expect(next.lastError!.timestamp).toBeGreaterThan(prev);
    // … while the error message itself is preserved.
    expect(next.lastError!.message).toBe("503 overloaded");
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe("no reachable bridge");
    expect(showToast.mock.calls[0][1]).toBe("error");
  });

  it("still toasts but leaves state untouched when the session has no lastError", () => {
    const clean = createInitialState();
    const { dispatch, showToast, getStates } = setup(new Map([["s1", clean]]));

    dispatch({ type: "retry_session_error", sessionId: "s1", error: "gone" } as ServerToBrowserMessage);

    expect(getStates().get("s1")).toBe(clean); // referential no-op
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe("error");
  });
});
