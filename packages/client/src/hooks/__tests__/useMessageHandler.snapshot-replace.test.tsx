/**
 * Regression suite for change: fix-stale-sessions-on-reconnect.
 *
 * Pin: `sessions_snapshot` REPLACES the client's `sessions` Map and
 * `sessionOrderMap`. It MUST NOT merge — stale ids from a previous
 * server lifetime have to be dropped atomically so an actually-running
 * session never lingers below the "Show N ended" sidebar divider after
 * a WebSocket reconnect.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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

  const setters: any = {
    setSessions,
    setSessionStates: vi.fn(),
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
  return { dispatch, sessionsRef, orderRef };
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
});

// Avoid TS unused-import warnings if SessionState moves.
type _Unused = SessionState;
