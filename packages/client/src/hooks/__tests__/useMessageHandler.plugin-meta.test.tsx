/**
 * `prompt_request` keeps namespaced `metadata.plugin` as `params._pluginMeta`
 * on the interactive request (task 4.2). Harness mirrors
 * `useMessageHandler.interactive-carry.test.tsx`.
 * See change: add-browser-editor-pane-tab (D6).
 */

import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import {
  __resetRuntimeLoaderForTests,
  getRuntimeLoaderState,
  loadRuntimePlugins,
  type RuntimeListingEntry,
  startRuntimePluginLoader,
} from "../../lib/plugins/runtime-plugin-loader.js";
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

// test-plan #E93 — `plugins_changed` → `plugins-changed` DOM event → loader re-fetch.
// See change: decouple-plugins-from-core (task 6.17).
describe("plugins_changed drives the runtime loader (task 6.17)", () => {
  afterEach(() => __resetRuntimeLoaderForTests());

  const entry = (id: string, sha: string): RuntimeListingEntry => ({
    id,
    displayName: id,
    priority: 1000,
    sha256: sha,
    entry: `/plugin-assets/${id}/${sha}/client.js`,
    eventTypes: [],
    claims: [{ slot: "session-card-badge", component: "B" }],
    routes: [],
  });

  it("upgrade asks for a reload without re-importing; a new plugin appears live; no location.reload", async () => {
    const reload = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, reload }, configurable: true });
    const registry = createSlotRegistry();
    let listing = [entry("ext", "1".repeat(64))];
    const importModule = vi.fn(async () => ({ B: () => null }));
    const deps = { registry, buildTimeIds: new Set<string>(), buildTimeRoutes: [], getApiBase: () => "", hasImportMap: () => true, fetchListing: async () => listing, importModule };
    const stop = startRuntimePluginLoader(deps);
    await loadRuntimePlugins(deps);
    expect(importModule).toHaveBeenCalledTimes(1);

    const { dispatch } = setup();
    listing = [entry("ext", "2".repeat(64))];
    await act(async () => {
      dispatch({ type: "plugins_changed", plugins: [] } as unknown as ServerToBrowserMessage);
      await loadRuntimePlugins(deps);
    });
    expect(getRuntimeLoaderState().reloadNeeded).toBe(true);
    expect(importModule).toHaveBeenCalledTimes(1);

    listing = [entry("ext", "2".repeat(64)), entry("ext3", "3".repeat(64))];
    await act(async () => {
      dispatch({ type: "plugins_changed", plugins: [] } as unknown as ServerToBrowserMessage);
      await loadRuntimePlugins(deps);
    });
    expect(importModule).toHaveBeenCalledTimes(2);
    expect(registry.getClaims("session-card-badge").map((c) => c.pluginId).sort()).toEqual(["ext", "ext3"]);
    expect(reload).not.toHaveBeenCalled();
    stop();
    Object.defineProperty(window, "location", { value: orig, configurable: true });
  });
});
