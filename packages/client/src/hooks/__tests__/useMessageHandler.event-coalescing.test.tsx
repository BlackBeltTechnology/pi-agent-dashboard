/**
 * Phase 3 (change: reduce-chat-render-cpu-umbrella): render-count probe.
 *
 * A burst of N live `event` messages arriving before the next animation frame
 * MUST produce at most ONE `setSessionStates` application (⇒ one ChatView
 * render), not N. Per-event side effects (seq tracking, replay buffer, plugin
 * mirror) stay synchronous — verified elsewhere; here we assert the state
 * setter is coalesced onto the rAF flush.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent, DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MessageHandlerDeps, type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

function liveEvent(sessionId: string, seq: number): Extract<ServerToBrowserMessage, { type: "event" }> {
  return {
    type: "event",
    sessionId,
    seq,
    event: { sessionId, eventType: "message_update", timestamp: seq, data: { assistantMessageEvent: { type: "text_delta", delta: `x${seq}` } } } as unknown as DashboardEvent,
  };
}

describe("useMessageHandler — live-event coalescing (render-count probe)", () => {
  let rafCallbacks: FrameRequestCallback[];
  let setSessionStates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rafCallbacks = [];
    // Capture rAF callbacks instead of running them, so we control the "frame".
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setSessionStates = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  function makeHandler() {
    const { result } = renderHook(() => {
      const setters = new Proxy({ setSessionStates }, {
        get: (target, prop) => (prop === "setSessionStates" ? setSessionStates : vi.fn()),
      }) as unknown as MessageHandlerSetters;
      const deps: any = {
        send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
        spawningCwdsRef: useRef(new Set<string>()), subscribedRef: useRef(new Set<string>()),
        pendingTerminalCwdRef: useRef(null), lastCreatedTerminalIdRef: useRef(null),
        maxSeqMapRef: useRef(new Map<string, number>()), selectedSessionIdRef: useRef(undefined),
        pendingSpawnsRef: useRef(new Map()), loadingHistoryTimersRef: useRef(new Map()),
        replayPersister: undefined,
      };
      return useMessageHandler(setters, deps);
    });
    return result.current;
  }

  it("a 200-event burst produces zero state applications before the frame, one after", () => {
    const handle = makeHandler();
    for (let seq = 1; seq <= 200; seq++) handle(liveEvent("s1", seq));

    // Nothing applied yet — all 200 events are queued for the next frame.
    expect(setSessionStates).toHaveBeenCalledTimes(0);
    // Exactly one rAF scheduled for the whole burst.
    expect(rafCallbacks).toHaveLength(1);

    // Fire the frame.
    for (const cb of rafCallbacks.splice(0)) cb(performance.now());

    // One state application for the entire burst ⇒ at most one render.
    expect(setSessionStates).toHaveBeenCalledTimes(1);
  });

  it("bursts across two frames apply once per frame", () => {
    const handle = makeHandler();
    handle(liveEvent("s1", 1));
    handle(liveEvent("s1", 2));
    for (const cb of rafCallbacks.splice(0)) cb(performance.now());
    expect(setSessionStates).toHaveBeenCalledTimes(1);

    handle(liveEvent("s1", 3));
    handle(liveEvent("s1", 4));
    for (const cb of rafCallbacks.splice(0)) cb(performance.now());
    expect(setSessionStates).toHaveBeenCalledTimes(2);
  });
});

/**
 * fix-connect-snapshot-frame-loss client message handling (D9): page merge,
 * reorder tail-keep, live endedTotals, openspec_get_result application, and
 * old-bundle tolerance of the new server frames.
 * Scenarios: test-plan E29, E33, E34, E35, E41, F4.
 */

type OpenSpecGetInflightForTest = { requestId: string; timer: ReturnType<typeof setTimeout> };

/** Synchronous mini-store standing in for one React state cell. */
function miniStore<T>(initial: T): {
  get: () => T;
  set: React.Dispatch<React.SetStateAction<T>>;
} {
  let value = initial;
  return {
    get: () => value,
    set: (upd) => {
      value = typeof upd === "function" ? (upd as (prev: T) => T)(value) : upd;
    },
  };
}

function makeSession(id: string, cwd: string, status: DashboardSession["status"] = "active"): DashboardSession {
  return { id, cwd, source: "tui", status, startedAt: 1_000, tokensIn: 0, tokensOut: 0, cost: 0 };
}

/**
 * Handler harness with REAL state application (unlike the vi.fn Proxy above)
 * so tests can observe merged Maps after a message sequence. `sessionsRef` is
 * refreshed after every handle() call, mirroring App's render-time ref update.
 */
function makeStatefulHandler(initial: {
  sessions?: Map<string, DashboardSession>;
  orders?: Map<string, string[]>;
  openspec?: Map<string, OpenSpecData>;
} = {}) {
  const sessions = miniStore(initial.sessions ?? new Map<string, DashboardSession>());
  const orders = miniStore(initial.orders ?? new Map<string, string[]>());
  const openspec = miniStore(initial.openspec ?? new Map<string, OpenSpecData>());
  const endedTotals = miniStore(new Map<string, number>());
  const paged = miniStore(new Map<string, number>());
  let snapshotGeneration = 0;
  const inflight = new Map<string, OpenSpecGetInflightForTest>();
  const sessionsRef = { current: sessions.get() } as React.MutableRefObject<Map<string, DashboardSession>>;

  const { result } = renderHook(() => {
    const setters: MessageHandlerSetters = {
      setSessions: sessions.set,
      setSessionStates: vi.fn(),
      setSessionCommands: vi.fn(),
      setFileResults: vi.fn(),
      setChangedOnDisk: vi.fn(),
      setOpenspecMap: openspec.set,
      setFolderGitMap: vi.fn(),
      setOpenspecGroupsMap: vi.fn(),
      setModelsMap: vi.fn(),
      setModelRefreshErrorsMap: vi.fn(),
      setRolesMap: vi.fn(),
      setSpawnResult: vi.fn(),
      setSessionOrderMap: orders.set,
      setPinnedDirectories: vi.fn(),
      setFavoriteModels: vi.fn(),
      setWorkspaces: vi.fn(),
      setTerminals: vi.fn(),
      setDiscoveredServers: vi.fn(),
      setSpawnErrors: vi.fn(),
      setResumeErrors: vi.fn(),
      setDisplayPrefs: vi.fn(),
      setLoadingHistory: vi.fn(),
      setReplayInFlight: vi.fn(),
      setCanvasMap: vi.fn(),
      setEndedTotalsMap: endedTotals.set,
      setPagedCount: paged.set,
      setSnapshotGeneration: (u) => {
        snapshotGeneration = typeof u === "function" ? u(snapshotGeneration) : u;
      },
    };
    const deps: MessageHandlerDeps = {
      send: vi.fn(),
      navigate: vi.fn(),
      clearSpawningCwd: vi.fn(),
      spawningCwdsRef: useRef(new Set<string>()),
      subscribedRef: useRef(new Set<string>()),
      pendingTerminalCwdRef: useRef(null),
      lastCreatedTerminalIdRef: useRef(null),
      maxSeqMapRef: useRef(new Map<string, number>()),
      selectedSessionIdRef: useRef(undefined),
      pendingSpawnsRef: useRef(new Map()),
      loadingHistoryTimersRef: useRef(new Map()),
      replayInFlightTimersRef: useRef(new Map()),
      replayPersister: undefined,
      sessionsRef,
      openspecGetInflightRef: { current: inflight } as React.MutableRefObject<Map<string, OpenSpecGetInflightForTest>>,
    };
    return useMessageHandler(setters, deps);
  });

  const handle = (msg: ServerToBrowserMessage) => {
    result.current(msg);
    sessionsRef.current = sessions.get();
  };
  return { handle, sessions, orders, openspec, endedTotals, paged, inflight, getSnapshotGeneration: () => snapshotGeneration };
}

describe("useMessageHandler — ended paging + endedTotals + openspec_get (fix-connect-snapshot-frame-loss)", () => {
  it("E29: sessions_page_result merges sessions, appends order, advances pagedCount", () => {
    const h = makeStatefulHandler({
      sessions: new Map([
        ["a", makeSession("a", "/g")],
        ["b", makeSession("b", "/g", "ended")],
      ]),
      orders: new Map([["/g", ["a", "b"]]]),
    });
    h.handle({
      type: "sessions_page_result",
      cwd: "/g",
      sessions: [makeSession("c", "/g", "ended"), makeSession("d", "/g", "ended"), makeSession("b", "/g", "ended")],
      order: ["c", "d", "b"],
      hasMore: false,
    });
    expect([...h.sessions.get().keys()].sort()).toEqual(["a", "b", "c", "d"]);
    expect(h.orders.get().get("/g")).toEqual(["a", "b", "c", "d"]);
    expect(h.paged.get().get("/g")).toBe(3);
  });

  it("E33: live sessions_reordered keeps paged ids at the tail", () => {
    const h = makeStatefulHandler({
      sessions: new Map([
        ["a", makeSession("a", "/g")],
        ["b", makeSession("b", "/g")],
        ["p1", makeSession("p1", "/g", "ended")],
        ["p2", makeSession("p2", "/g", "ended")],
      ]),
      orders: new Map([["/g", ["a", "b", "p1", "p2"]]]),
    });
    h.handle({ type: "sessions_reordered", cwd: "/g", sessionIds: ["b", "a"] });
    expect(h.orders.get().get("/g")).toEqual(["b", "a", "p1", "p2"]);
  });

  it("E34: unknown order ids are ignored without error", () => {
    const h = makeStatefulHandler({
      sessions: new Map([
        ["a", makeSession("a", "/g")],
        ["b", makeSession("b", "/g")],
      ]),
      orders: new Map([["/g", ["a", "b"]]]),
    });
    expect(() => h.handle({ type: "sessions_reordered", cwd: "/g", sessionIds: ["a", "ghost", "b"] })).not.toThrow();
    expect(h.orders.get().get("/g")).toEqual(["a", "b"]);
  });

  it("E35: endedTotals load — session_updated→ended increments, session_removed of an ended decrements", () => {
    const h = makeStatefulHandler();
    h.handle({
      type: "sessions_snapshot",
      sessions: [makeSession("g1", "/g", "active"), makeSession("g2", "/g", "ended")],
      orders: { "/g": ["g1", "g2"] },
      endedTotals: { "/g": 2 },
      archivedCountByCwd: {},
    });
    expect(h.endedTotals.get().get("/g")).toBe(2);
    expect(h.getSnapshotGeneration()).toBe(1);
    expect(h.paged.get().size).toBe(0);

    h.handle({ type: "session_updated", sessionId: "g1", updates: { status: "ended" } });
    expect(h.endedTotals.get().get("/g")).toBe(3);

    h.handle({ type: "session_removed", sessionId: "g2" });
    expect(h.endedTotals.get().get("/g")).toBe(2);
  });

  it("E41: openspec_get_result applies like openspec_update; in-flight released only on final:true", () => {
    const h = makeStatefulHandler();
    const timer = setTimeout(() => {}, 15_000);
    h.inflight.set("/w", { requestId: "r1", timer });
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const placeholder: OpenSpecData = { initialized: false, pending: true, hasOpenspecDir: true, changes: [] };
    h.handle({ type: "openspec_get_result", requestId: "r1", cwd: "/w", data: placeholder, final: false });
    expect(h.openspec.get().get("/w")).toEqual(placeholder);
    expect(h.inflight.has("/w")).toBe(true);

    const final: OpenSpecData = { initialized: true, changes: [] };
    h.handle({ type: "openspec_get_result", requestId: "r1", cwd: "/w", data: final, final: true });
    expect(h.openspec.get().get("/w")).toEqual(final);
    expect(h.inflight.has("/w")).toBe(false);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    clearTimeoutSpy.mockRestore();
  });

  it("F4: new-server frame sequence applies without throwing; snapshot replaces; unknown types ignored", () => {
    const h = makeStatefulHandler({
      // Pre-change state fixture: ids from a previous server lifetime.
      sessions: new Map([["stale", makeSession("stale", "/old", "active")]]),
      orders: new Map([["/old", ["stale"]]]),
    });
    const windowed = [
      makeSession("live1", "/g", "active"),
      makeSession("e1", "/g", "ended"),
      makeSession("e2", "/g", "ended"),
      makeSession("e3", "/g", "ended"),
    ];
    const data: OpenSpecData = { initialized: true, changes: [] };
    expect(() => {
      // State frames first (D1/D3 connect order)…
      h.handle({ type: "openspec_update", cwd: "/g", data });
      h.handle({ type: "git_head_update", cwd: "/g", branch: "main" });
      // …then the one large windowed snapshot frame.
      h.handle({ type: "sessions_snapshot", sessions: windowed, orders: { "/g": ["live1", "e1", "e2", "e3"] }, endedTotals: { "/g": 10 }, archivedCountByCwd: {} });
      h.handle({ type: "openspec_get_result", requestId: "r9", cwd: "/g", data, final: true });
      h.handle({ type: "sessions_page_result", cwd: "/g", sessions: [makeSession("e4", "/g", "ended")], order: ["e4"], hasMore: true });
      // A future server frame an old bundle has no case for.
      h.handle({ type: "mystery_frame" } as unknown as ServerToBrowserMessage);
    }).not.toThrow();
    expect([...h.sessions.get().keys()].sort()).toEqual(["e1", "e2", "e3", "e4", "live1"]);
    expect(h.endedTotals.get().get("/g")).toBe(10);
    expect(h.paged.get().get("/g")).toBe(1);
    expect(h.getSnapshotGeneration()).toBe(1);
  });
});
