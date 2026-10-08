/**
 * `prompt_request` keeps namespaced `metadata.plugin` as `params._pluginMeta`
 * on the interactive request (task 4.2). Harness mirrors
 * `useMessageHandler.interactive-carry.test.tsx`.
 * See change: add-browser-editor-pane-tab (D6).
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import { useMessageHandler } from "../useMessageHandler.js";

const SID = "session-1";

function setup() {
  const sessionStatesRef = { current: new Map<string, SessionState>() };
  const maxSeqMap = new Map<string, number>();

  const setSessionStates = vi.fn((updater: any) => {
    if (typeof updater === "function") {
      sessionStatesRef.current = updater(sessionStatesRef.current);
    } else {
      sessionStatesRef.current = updater;
    }
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
    setReplayInFlight: vi.fn(),
  };

  const deps: any = {
    send: vi.fn(),
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() },
    subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: maxSeqMap },
    selectedSessionIdRef: { current: undefined },
    loadingHistoryTimersRef: { current: new Map() },
    replayInFlightTimersRef: { current: new Map() },
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);

  return { dispatch, sessionStatesRef, maxSeqMap };
}


const plugin = { pluginId: "browser", kind: "browser-takeover", instanceId: "i1" };

const promptWith = (promptId: string, metadata: Record<string, unknown> | undefined): ServerToBrowserMessage =>
  ({
    type: "prompt_request",
    sessionId: SID,
    promptId,
    prompt: { question: "Log in?", type: "confirm", ...(metadata ? { metadata } : {}) },
    component: { type: "confirm", props: {} },
    placement: "inline",
  }) as ServerToBrowserMessage;

describe("prompt_request metadata.plugin (task 4.2)", () => {
  it("copies metadata.plugin into params._pluginMeta, next to the core fields", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(promptWith("p1", { message: "m", plugin }));
    const req = sessionStatesRef.current.get(SID)?.interactiveRequests[0];
    expect(req?.params._pluginMeta).toEqual(plugin);
    expect(req?.params.message).toBe("m");
  });
  it("a prompt without metadata.plugin has no _pluginMeta", () => {
    const { dispatch, sessionStatesRef } = setup();
    dispatch(promptWith("p2", { message: "m" }));
    expect(sessionStatesRef.current.get(SID)?.interactiveRequests[0]?.params._pluginMeta).toBeUndefined();
  });
});
