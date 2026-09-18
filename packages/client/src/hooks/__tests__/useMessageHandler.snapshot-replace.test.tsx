/**
 * Regression suite for change: fix-stale-sessions-on-reconnect.
 *
 * Pin: `sessions_snapshot` REPLACES the client's `sessions` Map and
 * `sessionOrderMap`. It MUST NOT merge — stale ids from a previous
 * server lifetime have to be dropped atomically so an actually-running
 * session never lingers below the "Show N ended" sidebar divider after
 * a WebSocket reconnect.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import { type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

function makeSession(id: string, overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id,
    cwd: "/tmp/repo",
    source: "tui",
    status: "active",
    startedAt: 1,
    hidden: false,
    dataUnavailable: false,
    ...overrides,
  } as DashboardSession;
}

function setup(initialSessions?: DashboardSession[], initialOrders?: Record<string, string[]>) {
  const sessionsRef = {
    current: new Map<string, DashboardSession>(
      (initialSessions ?? []).map((s) => [s.id, s] as const),
    ),
  };
  const orderRef = {
    current: new Map<string, string[]>(Object.entries(initialOrders ?? {})),
  };

  const setSessions = vi.fn((updater: any) => {
    sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
  });
  const setSessionOrderMap = vi.fn((updater: any) => {
    orderRef.current = typeof updater === "function" ? updater(orderRef.current) : updater;
  });
  const setSessionStates = vi.fn();

  const setters: any = {
    setSessions,
    setSessionStates,
    setSessionCommands: vi.fn(),
    setSessionFlows: vi.fn(),
    setFileResults: vi.fn(),
    setOpenspecMap: vi.fn(),
    setModelsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap,
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(),
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() },
    subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  const dispatch = (msg: ServerToBrowserMessage) => result.current(msg);

  // Seed the closured state by routing initial values through the setters.
  // (renderHook returns the latest callback; setSessions/setSessionOrderMap
  // here just install the seeded refs above so post-dispatch refs reflect
  // the snapshot result.)
  return { dispatch, sessionsRef, orderRef, setSessionStates };
}

const SNAPSHOT = (
  sessions: DashboardSession[],
  orders: Record<string, string[]>,
): ServerToBrowserMessage =>
  ({ type: "sessions_snapshot", sessions, orders } as ServerToBrowserMessage);

describe("useMessageHandler sessions_snapshot REPLACE semantics", () => {
  it("drops stale session id absent from snapshot", () => {
    const stale = makeSession("stale-x", { status: "active" });
    const fresh = makeSession("fresh-y", { status: "active" });
    const { dispatch, sessionsRef } = setup([stale]);

    dispatch(SNAPSHOT([fresh], {}));

    expect(sessionsRef.current.has("stale-x")).toBe(false);
    expect(sessionsRef.current.has("fresh-y")).toBe(true);
  });

  it("replaces sessionOrderMap completely \u2014 cwd absent from snapshot is dropped", () => {
    const { dispatch, orderRef } = setup([], { "/repoA": ["a", "b"] });

    dispatch(SNAPSHOT([], { "/repoB": ["c"] }));

    expect(orderRef.current.get("/repoA")).toBeUndefined();
    expect(orderRef.current.get("/repoB")).toEqual(["c"]);
  });

  it("overwrites status of an existing id when snapshot says ended", () => {
    const liveY = makeSession("live-y", { status: "active" });
    const endedY = makeSession("live-y", { status: "ended", endedAt: 999 });
    const { dispatch, sessionsRef } = setup([liveY]);

    dispatch(SNAPSHOT([endedY], {}));

    expect(sessionsRef.current.get("live-y")?.status).toBe("ended");
  });

  it("empty snapshot drops every session and every order", () => {
    const { dispatch, sessionsRef, orderRef } = setup(
      [makeSession("a"), makeSession("b")],
      { "/repo": ["a", "b"] },
    );

    dispatch(SNAPSHOT([], {}));

    expect(sessionsRef.current.size).toBe(0);
    expect(orderRef.current.size).toBe(0);
  });

  it("X7 reconnect snapshot without session_removed preserves retry/error state", () => {
    const live = makeSession("s1", { status: "active" });
    const { dispatch, setSessionStates } = setup([live]);

    dispatch(SNAPSHOT([live], { "/tmp/repo": ["s1"] }));

    expect(setSessionStates).not.toHaveBeenCalled();
  });
});

// ── close-registry-frame-shed-gaps (D2/D3) ────────────────────────────────
// Reconciled-add upsert + paging generation/exhausted marks. These use REAL
// React state (not vi.fn doubles) because the exhausted mark clears through a
// render-committed diff on the `endedTotals` map.

interface HarnessInit {
  sessions?: DashboardSession[];
  orders?: Record<string, string[]>;
  endedTotals?: Record<string, number>;
  pagedCount?: Record<string, number>;
  pageReplyGen?: Record<string, number>;
  pageExhausted?: string[];
  pinnedDirectories?: string[];
}

function useHarness(init: HarnessInit) {
  const [sessions, setSessions] = useState<Map<string, DashboardSession>>(
    () => new Map((init.sessions ?? []).map((s) => [s.id, s] as const)),
  );
  const [orders, setSessionOrderMap] = useState<Map<string, string[]>>(
    () => new Map(Object.entries(init.orders ?? {})),
  );
  const [endedTotalsMap, setEndedTotalsMap] = useState<Map<string, number>>(
    () => new Map(Object.entries(init.endedTotals ?? {})),
  );
  const [pagedCount, setPagedCount] = useState<Map<string, number>>(
    () => new Map(Object.entries(init.pagedCount ?? {})),
  );
  const [pageReplyGen, setPageReplyGen] = useState<Map<string, number>>(
    () => new Map(Object.entries(init.pageReplyGen ?? {})),
  );
  const [pageExhausted, setPageExhausted] = useState<Set<string>>(
    () => new Set(init.pageExhausted ?? []),
  );
  const [, setSnapshotGeneration] = useState(0);

  const sessionsRef = useRef<Map<string, DashboardSession>>(sessions);
  sessionsRef.current = sessions;
  const pendingSpawnsRef = useRef(
    new Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>(),
  );
  const cwdVisibilityInputsRef = useRef({
    pinnedDirectories: init.pinnedDirectories ?? [],
    workspaces: [] as Array<{ folders: ReadonlyArray<string> }>,
    sessions: [] as Array<{ cwd: string }>,
  });

  const setters: MessageHandlerSetters = {
    setSessions,
    setSessionStates: vi.fn(),
    setSessionCommands: vi.fn(),
    setFileResults: vi.fn(),
    setChangedOnDisk: vi.fn(),
    setOpenspecMap: vi.fn(),
    setFolderGitMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(),
    setModelRefreshErrorsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap,
    setPinnedDirectories: vi.fn(),
    setCollapsedFolders: vi.fn(),
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
    setEndedTotalsMap,
    setPagedCount,
    setSnapshotGeneration,
    setPageReplyGen,
    setPageExhausted,
  };
  const deps: any = {
    send: vi.fn(),
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set<string>() },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef,
    sessionsRef,
    cwdVisibilityInputsRef,
    endedTotalsMap,
  };

  const handler = useMessageHandler(setters, deps);
  return {
    handler,
    sessions,
    orders,
    endedTotalsMap,
    pageReplyGen,
    pageExhausted,
    setEndedTotalsMap,
  };
}

function makeStatefulHandler(init: HarnessInit = {}) {
  const { result } = renderHook(() => useHarness(init));
  return {
    handle: (msg: ServerToBrowserMessage) =>
      act(() => {
        result.current.handler(msg);
      }),
    /** Mirrors App.tsx `clearInMemoryState` (server switch / disconnect). */
    resetServerScopedState: () =>
      act(() => {
        result.current.setEndedTotalsMap(new Map());
      }),
    getSessions: () => result.current.sessions,
    getOrders: () => result.current.orders,
    getEndedTotals: () => result.current.endedTotalsMap,
    getPageReplyGen: () => result.current.pageReplyGen,
    getPageExhausted: () => result.current.pageExhausted,
  };
}

describe("useMessageHandler — reconciled add upsert + endedTotals (close-registry-frame-shed-gaps)", () => {
  it("F5: a reconciled add merges over the held row and spares sibling resuming state", () => {
    const s5 = makeSession("s5", {
      cwd: "/repoA",
      resuming: true,
      assets: { h1: { data: "d", mimeType: "text/plain" } },
    });
    const sibling = makeSession("sib", { cwd: "/repoA", resuming: true });
    const h = makeStatefulHandler({ sessions: [s5, sibling] });

    h.handle({
      type: "session_added",
      session: makeSession("s5", { cwd: "/repoA", status: "active", name: "renamed" }),
      reconciled: true,
    } as ServerToBrowserMessage);

    const held = h.getSessions();
    expect(held.get("s5")?.name).toBe("renamed");
    // Merge, not wholesale replace: a client-local field survives the upsert.
    expect(held.get("s5")?.assets?.h1).toEqual({ data: "d", mimeType: "text/plain" });
    // Updated, not duplicated.
    expect([...held.keys()]).toEqual(["s5", "sib"]);
    // Sibling `resuming` untouched by the late repair.
    expect(held.get("sib")?.resuming).toBe(true);
  });

  it("E16: an added ended session counts toward the ended total", () => {
    const h = makeStatefulHandler({ endedTotals: { "/repoA": 4 } });

    h.handle({
      type: "session_added",
      session: makeSession("s9", { cwd: "/repoA", status: "ended" }),
    } as ServerToBrowserMessage);

    expect(h.getEndedTotals().get("/repoA")).toBe(5);
  });

  it("E17: a re-delivered ended session is not double-counted", () => {
    const s9 = makeSession("s9", { cwd: "/repoA", status: "ended" });
    const h = makeStatefulHandler({ sessions: [s9], endedTotals: { "/repoA": 5 } });

    h.handle({ type: "session_added", session: s9 } as ServerToBrowserMessage);

    expect(h.getEndedTotals().get("/repoA")).toBe(5);
  });

  it("a reconciled add takes the server's fields but keeps client-local ones", () => {
    // The reconcile payload is the server's FULL current record, so an ABSENT
    // optional field (`currentTool` on a freshly re-registered row) is
    // authoritative — a plain `{...existing, ...msg.session}` merge would keep
    // the PREVIOUS incarnation's tool, the exact class of staleness this change
    // exists to kill. `resuming`/`closing` (and the client-accumulated
    // `assets`) are not server-owned and must survive.
    const held = {
      ...makeSession("s5", { cwd: "/repoA" }),
      currentTool: "stale-tool",
      resuming: true,
      closing: true,
      assets: { h1: { data: "x", mimeType: "image/png" } },
    };
    const h = makeStatefulHandler({ sessions: [held] });

    h.handle({
      type: "session_added",
      session: makeSession("s5", { cwd: "/repoA" }),
      reconciled: true,
    } as ServerToBrowserMessage);

    const row = h.getSessions().get("s5");
    expect(row?.currentTool).toBeUndefined();
    expect(row?.resuming).toBe(true);
    expect(row?.closing).toBe(true);
    expect(row?.assets).toEqual({ h1: { data: "x", mimeType: "image/png" } });
  });

  it("an add that flips a held ended row back to live removes its ended contribution", () => {
    // An owed removal superseded by re-registration arrives as a reconciled add
    // for a row the browser holds as ENDED. Leaving the ended total untouched
    // makes the group's count stale, so the expander offers a page that can
    // never fill.
    const s8 = makeSession("s8", { cwd: "/repoA", status: "ended" });
    const h = makeStatefulHandler({ sessions: [s8], endedTotals: { "/repoA": 5 } });

    h.handle({
      type: "session_added",
      session: makeSession("s8", { cwd: "/repoA", status: "active" }),
      reconciled: true,
    } as ServerToBrowserMessage);

    expect(h.getEndedTotals().get("/repoA")).toBe(4);
    expect(h.getSessions().get("s8")?.status).toBe("active");
  });

  it("F6: a deferred reorder does not lose a concurrently added session", () => {
    const h = makeStatefulHandler({
      sessions: [makeSession("a", { cwd: "/repoA" }), makeSession("b", { cwd: "/repoA" })],
      orders: { "/repoA": ["a", "b"] },
    });

    h.handle({ type: "session_added", session: makeSession("c", { cwd: "/repoA" }) } as ServerToBrowserMessage);
    h.handle({ type: "sessions_reordered", cwd: "/repoA", sessionIds: ["b", "a"] } as ServerToBrowserMessage);

    expect(h.getOrders().get("/repoA")).toEqual(["b", "a", "c"]);
  });
});

describe("useMessageHandler — paging generation + exhausted (close-registry-frame-shed-gaps D3)", () => {
  it("E18: a page reply bumps the generation and toggles exhausted from hasMore", () => {
    const h = makeStatefulHandler({ pageReplyGen: { "/a": 1 } });

    h.handle({ type: "sessions_page_result", cwd: "/a", sessions: [], order: [], hasMore: false } as ServerToBrowserMessage);
    expect(h.getPageReplyGen().get("/a")).toBe(2);
    expect(h.getPageExhausted().has("/a")).toBe(true);

    h.handle({ type: "sessions_page_result", cwd: "/a", sessions: [], order: [], hasMore: true } as ServerToBrowserMessage);
    expect(h.getPageReplyGen().get("/a")).toBe(3);
    expect(h.getPageExhausted().has("/a")).toBe(false);
  });

  it("E19: every endedTotals mutation clears the exhausted mark for the changed group", () => {
    // 1. session_updated → ended
    {
      const h = makeStatefulHandler({
        sessions: [makeSession("s1", { cwd: "/repoA" })],
        endedTotals: { "/repoA": 4 },
        pageExhausted: ["/repoA"],
      });
      h.handle({ type: "session_updated", sessionId: "s1", updates: { status: "ended" } } as ServerToBrowserMessage);
      expect(h.getPageExhausted().has("/repoA")).toBe(false);
    }
    // 2. session_removed (held ended → −1)
    {
      const h = makeStatefulHandler({
        sessions: [makeSession("s2", { cwd: "/repoA", status: "ended" })],
        endedTotals: { "/repoA": 4 },
        pageExhausted: ["/repoA"],
      });
      h.handle({ type: "session_removed", sessionId: "s2" } as ServerToBrowserMessage);
      expect(h.getPageExhausted().has("/repoA")).toBe(false);
    }
    // 3. session_archived
    {
      const h = makeStatefulHandler({
        sessions: [makeSession("s3", { cwd: "/repoA", status: "ended" })],
        endedTotals: { "/repoA": 4 },
        pageExhausted: ["/repoA"],
      });
      h.handle({ type: "session_archived", sessionId: "s3", cwd: "/repoA", count: 1 } as ServerToBrowserMessage);
      expect(h.getPageExhausted().has("/repoA")).toBe(false);
    }
    // 4. snapshot — clears unconditionally even when the total is byte-identical
    {
      const h = makeStatefulHandler({ endedTotals: { "/repoA": 4 }, pageExhausted: ["/repoA"] });
      h.handle({
        type: "sessions_snapshot",
        sessions: [],
        orders: {},
        endedTotals: { "/repoA": 4 },
        archivedCountByCwd: {},
      } as ServerToBrowserMessage);
      expect(h.getPageExhausted().has("/repoA")).toBe(false);
    }
    // 5. App server-switch / disconnect reset of endedTotals
    {
      const h = makeStatefulHandler({ endedTotals: { "/repoA": 4 }, pageExhausted: ["/repoA"] });
      h.resetServerScopedState();
      expect(h.getPageExhausted().has("/repoA")).toBe(false);
    }
    // 6. session_added of a not-previously-held ended session
    {
      const h = makeStatefulHandler({ endedTotals: { "/repoA": 4 }, pageExhausted: ["/repoA"] });
      h.handle({
        type: "session_added",
        session: makeSession("s9", { cwd: "/repoA", status: "ended" }),
      } as ServerToBrowserMessage);
      expect(h.getPageExhausted().has("/repoA")).toBe(false);
    }
  });

  it("E20: paging marks live in the group-key space (worktree session)", () => {
    const wt = makeSession("wt1", {
      cwd: "/repoA/.worktrees/wt1",
      gitWorktree: { mainPath: "/repoA", name: "wt1" },
    });
    const h = makeStatefulHandler({ sessions: [wt], endedTotals: { "/repoA": 1 } });

    h.handle({ type: "sessions_page_result", cwd: "/repoA", sessions: [], order: [], hasMore: false } as ServerToBrowserMessage);
    expect(h.getPageExhausted().has("/repoA")).toBe(true);

    h.handle({ type: "session_updated", sessionId: "wt1", updates: { status: "ended" } } as ServerToBrowserMessage);
    expect(h.getEndedTotals().get("/repoA")).toBe(2);
    expect(h.getPageExhausted().has("/repoA")).toBe(false);
  });
});

// Avoid TS unused-import warnings if SessionState moves.
type _Unused = SessionState;
