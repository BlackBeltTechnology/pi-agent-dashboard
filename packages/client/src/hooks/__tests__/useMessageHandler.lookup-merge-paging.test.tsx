/**
 * Test-plan #F8 and #F22 — a session merged by the deep-link lookup must not
 * disturb ended paging: it lands in the order map once, at its page position,
 * and the held-ended count / next offset ignore it until a page delivers it.
 * See change: add-session-ui-deep-links-for-agents (D3).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { heldEndedByGroup } from "../../lib/session/held-ended.js";
import { addLookupOnly, mergeLookupRows } from "../../lib/session/lookup-merge.js";
import { useMessageHandler } from "../useMessageHandler.js";

const G = "/tmp/g";
const ended = (id: string): DashboardSession =>
  ({ id, cwd: G, source: "tui", status: "ended", startedAt: 1, endedAt: 2, hidden: false, dataUnavailable: false }) as DashboardSession;

function setup() {
  const st = {
    sessions: new Map<string, DashboardSession>(),
    order: new Map<string, string[]>(),
    paged: new Map<string, number>(),
    lookupOnly: new Set<string>(),
  };
  const apply = <T,>(cur: T, u: unknown): T => (typeof u === "function" ? (u as (p: T) => T)(cur) : (u as T));
  const setters = {
    setSessions: vi.fn((u: unknown) => { st.sessions = apply(st.sessions, u); }),
    setSessionOrderMap: vi.fn((u: unknown) => { st.order = apply(st.order, u); }),
    setPagedCount: vi.fn((u: unknown) => { st.paged = apply(st.paged, u); }),
    setLookupOnlyIds: vi.fn((u: unknown) => { st.lookupOnly = apply(st.lookupOnly, u); }),
    setPageReplyGen: vi.fn(),
    setPageExhausted: vi.fn(),
    setSessionStates: vi.fn(), setSessionCommands: vi.fn(), setFileResults: vi.fn(), setOpenspecMap: vi.fn(),
    setModelsMap: vi.fn(), setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setPinnedDirectories: vi.fn(),
    setFavoriteModels: vi.fn(), setTerminals: vi.fn(), setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
  };
  const deps = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() }, selectedSessionIdRef: { current: undefined },
  };
  const { result } = renderHook(() => useMessageHandler(setters as never, deps as never));
  const lookupMerge = (rows: DashboardSession[]) => {
    st.sessions = mergeLookupRows(st.sessions, rows);
    st.lookupOnly = addLookupOnly(st.lookupOnly, rows.map((r) => r.id));
  };
  return { st, dispatch: (m: ServerToBrowserMessage) => result.current(m), lookupMerge };
}

const page = (ids: string[], hasMore = true): ServerToBrowserMessage =>
  ({ type: "sessions_page_result", cwd: G, sessions: ids.map(ended), order: ids, hasMore }) as unknown as ServerToBrowserMessage;

describe("lookup-merged rows and ended paging", () => {
  it("F8: old1 appears exactly once in the group order, at the page position", () => {
    const { st, dispatch, lookupMerge } = setup();
    lookupMerge([ended("old1")]);
    expect(st.order.get(G)).toBeUndefined(); // lookup never touches the order map
    dispatch(page(["p1", "old1", "p2"]));
    expect(st.order.get(G)).toEqual(["p1", "old1", "p2"]);
    expect(st.order.get(G)?.filter((i) => i === "old1")).toHaveLength(1);
  });

  it("F22: a looked-up row does not count as held; after its page it counts toward the next offset", () => {
    const { st, dispatch, lookupMerge } = setup();
    const totals = new Map([[G, 200]]);
    lookupMerge([ended("old1")]);

    // Expand: held-ended ignores old1, so paging is NOT suppressed and offset is 0.
    const heldBefore = heldEndedByGroup([...st.sessions.values()], [], st.lookupOnly).get(G) ?? 0;
    expect(heldBefore).toBe(0);
    expect((totals.get(G) ?? 0) <= heldBefore).toBe(false);
    expect(st.paged.get(G) ?? 0).toBe(0);

    const ids = ["old1", ...Array.from({ length: 49 }, (_, i) => `p${i}`)];
    dispatch(page(ids));
    expect(st.lookupOnly.has("old1")).toBe(false);
    expect(st.paged.get(G)).toBe(50); // next offset = page size
    expect(st.order.get(G)?.filter((i) => i === "old1")).toHaveLength(1);
    expect(heldEndedByGroup([...st.sessions.values()], [], st.lookupOnly).get(G)).toBe(50);
  });

  it("a snapshot clears the lookup-only set", () => {
    const { st, dispatch, lookupMerge } = setup();
    lookupMerge([ended("old1")]);
    dispatch({ type: "sessions_snapshot", sessions: [], orders: {} } as unknown as ServerToBrowserMessage);
    expect(st.lookupOnly.size).toBe(0);
  });
});
