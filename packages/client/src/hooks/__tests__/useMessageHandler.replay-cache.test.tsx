import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CachedEvent, createReplayCache } from "../../lib/replay/replay-cache.js";
import { createReplayPersister } from "../../lib/replay/replay-persist.js";
import { type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

function noopSetters(): MessageHandlerSetters {
  return new Proxy({}, { get: () => vi.fn() }) as unknown as MessageHandlerSetters;
}

function liveEvent(sessionId: string, seq: number): Extract<ServerToBrowserMessage, { type: "event" }> {
  return {
    type: "event",
    sessionId,
    seq,
    event: { sessionId, eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

const KEY = "a:8000";

describe("useMessageHandler — Strategy A replay-cache invalidation", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("session_state_reset purges the persisted cache entry", async () => {
    const cache = createReplayCache({ factory });
    const persister = createReplayPersister(cache, 0, () => KEY);

    const { result } = renderHook(() => {
      const maxSeqMapRef = useRef(new Map<string, number>());
      const deps: any = {
        send: vi.fn(),
        navigate: vi.fn(),
        clearSpawningCwd: vi.fn(),
        spawningCwdsRef: useRef(new Set<string>()),
        subscribedRef: useRef(new Set<string>()),
        pendingTerminalCwdRef: useRef(null),
        lastCreatedTerminalIdRef: useRef(null),
        maxSeqMapRef,
        selectedSessionIdRef: useRef(undefined),
        pendingSpawnsRef: useRef(new Map()),
        loadingHistoryTimersRef: useRef(new Map()),
        replayInFlightTimersRef: useRef(new Map()),
        replayPersister: persister,
      };
      return useMessageHandler(noopSetters(), deps);
    });

    const handle = result.current;
    // A replay envelope establishes provenance (only a buffer descended from
    // THIS tab's own replay is persistable — fix-replay-cache-partial-payload-cursor).
    handle({
      type: "event_replay",
      sessionId: "s1",
      events: [{ seq: 1, event: liveEvent("s1", 1).event }],
      isLast: true,
    } as ServerToBrowserMessage);
    // Live events then accumulate into the durable buffer and persist.
    handle(liveEvent("s1", 2));
    await persister.flush("s1");
    expect(await cache.get("s1", KEY)).not.toBeNull();

    // A server-side seq reset must purge the entry → next load full-replays.
    handle({ type: "session_state_reset", sessionId: "s1" } as ServerToBrowserMessage);
    // drop() fires cache.delete; give the microtask queue a tick.
    await persister.flush("s1");
    expect(await cache.get("s1", KEY)).toBeNull();
  });
});

// ── archive-sessions-lazy-load: snapshot + eviction semantics ────────────
// #E31: `sessions_snapshot` REPLACES `archivedCountByCwd` atomically.
// #E32: `session_archived` DELETES the id (distinct from `session_removed`,
// which keeps the row as ended). See change: archive-sessions-lazy-load.
describe("useMessageHandler — archived counts (archive-sessions-lazy-load)", () => {
  function setupArchived(initialSessions: DashboardSessionLike[]) {
    const sessionsRef = { current: new Map(initialSessions.map((s) => [s.id, s])) };
    const countsRef = { current: new Map<string, number>([["/repoA", 5]]) };
    const setSessions = vi.fn((updater: any) => {
      sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
    });
    const setArchivedCountMap = vi.fn((updater: any) => {
      countsRef.current = typeof updater === "function" ? updater(countsRef.current) : updater;
    });
    const setters: any = new Proxy(
      { setSessions, setArchivedCountMap },
      { get: (target: any, prop: string) => (prop in target ? target[prop] : vi.fn()) },
    );
    const deps: any = {
      send: vi.fn(),
      navigate: vi.fn(),
      clearSpawningCwd: vi.fn(),
      spawningCwdsRef: { current: new Set() },
      subscribedRef: { current: new Set() },
      pendingTerminalCwdRef: { current: null },
      lastCreatedTerminalIdRef: { current: null },
      maxSeqMapRef: { current: new Map() },
      selectedSessionIdRef: { current: undefined },
      sessionsRef,
    };
    const { result } = renderHook(() => useMessageHandler(setters, deps));
    return { dispatch: (msg: any) => result.current(msg), sessionsRef, countsRef };
  }

  type DashboardSessionLike = { id: string; cwd: string; status: string; [k: string]: unknown };

  function archivedSession(id: string, overrides: Record<string, unknown> = {}): DashboardSessionLike {
    return {
      id,
      cwd: "/repoA",
      source: "tui",
      status: "ended",
      startedAt: 1,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      ...overrides,
    };
  }

  it("E31: snapshot replaces archivedCountByCwd completely — stale cwd dropped", () => {
    const { dispatch, countsRef } = setupArchived([]);
    // Seeded with { "/repoA": 5 } above.
    dispatch({
      type: "sessions_snapshot",
      sessions: [],
      orders: {},
      endedTotals: {},
      archivedCountByCwd: { "/repoB": 312 },
    });
    expect(countsRef.current.get("/repoA")).toBeUndefined();
    expect(countsRef.current.get("/repoB")).toBe(312);
  });

  it("E31: tolerates a snapshot from a pre-change server (missing field → empty)", () => {
    const { dispatch, countsRef } = setupArchived([]);
    dispatch({ type: "sessions_snapshot", sessions: [], orders: {}, endedTotals: {} });
    expect(countsRef.current.size).toBe(0);
  });

  it("E32: session_archived deletes the id and sets the folder count", () => {
    const oldZ = archivedSession("old-z");
    const kept = archivedSession("kept-y");
    const { dispatch, sessionsRef, countsRef } = setupArchived([oldZ, kept]);

    dispatch({ type: "session_archived", sessionId: "old-z", cwd: "/repoA", count: 6 });

    expect(sessionsRef.current.has("old-z")).toBe(false);
    expect(countsRef.current.get("/repoA")).toBe(6);
    // Unrelated ids are untouched.
    expect(sessionsRef.current.has("kept-y")).toBe(true);
  });

  it("E32: session_removed still KEEPS the row (marks ended, preserves)", () => {
    const other = archivedSession("other-w", { status: "active" });
    const { dispatch, sessionsRef } = setupArchived([other]);

    dispatch({ type: "session_removed", sessionId: "other-w" });

    const row = sessionsRef.current.get("other-w");
    expect(row).toBeDefined();
    expect((row as any).status).toBe("ended");
  });
});
