/**
 * Task 4.2 for change: bound-bridge-resume-replay.
 *
 * On a `frames_dropped` notice the client issues ONE bounded re-subscribe
 * (lastSeq:0 → server replays only the bounded tail window), and only when it
 * is actually subscribed to that session. No eager full replay.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import { useMessageHandler } from "../useMessageHandler.js";

function setup(subscribed: string[] = []) {
  const sessionStatesRef = { current: new Map<string, SessionState>() };
  const setSessionStates = vi.fn((updater: any) => {
    sessionStatesRef.current =
      typeof updater === "function" ? updater(sessionStatesRef.current) : updater;
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
  };
  const send = vi.fn();
  const deps: any = {
    send,
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() },
    subscribedRef: { current: new Set(subscribed) },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() },
    selectedSessionIdRef: { current: undefined },
    loadingHistoryTimersRef: { current: new Map() },
    setOldestLoadedSeq: vi.fn(),
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);
  return { dispatch, send };
}

describe("useMessageHandler frames_dropped re-subscribe", () => {
  const SID = "session-1";

  it("issues exactly one bounded re-subscribe (lastSeq:0) when subscribed", () => {
    const { dispatch, send } = setup([SID]);
    dispatch({ type: "frames_dropped", sessionId: SID, dropped: 6 } as ServerToBrowserMessage);
    const subs = send.mock.calls.filter((c) => c[0]?.type === "subscribe");
    expect(subs).toHaveLength(1);
    expect(subs[0][0]).toEqual({ type: "subscribe", sessionId: SID, lastSeq: 0 });
  });

  it("does NOT re-subscribe when not subscribed to the session", () => {
    const { dispatch, send } = setup([]); // not subscribed
    dispatch({ type: "frames_dropped", sessionId: SID, dropped: 6 } as ServerToBrowserMessage);
    expect(send.mock.calls.filter((c) => c[0]?.type === "subscribe")).toHaveLength(0);
  });
});
