/**
 * Test-plan #F1–#F7, #X1, #X2 — `useSessionRouteResolution` (design D3).
 * See change: add-session-ui-deep-links-for-agents.
 */
import type { SessionListItem } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionLookupAuthError } from "../../lib/api/sessions-lookup-api.js";
import { addLookupOnly, mergeLookupRows } from "../../lib/session/lookup-merge.js";
import {
  type SessionRouteResolution,
  useCanonicalRouteUrl,
  useSessionRouteResolution,
  useVanishedRedirect,
} from "../useSessionRouteResolution.js";

const row = (id: string, over: Partial<DashboardSession> = {}): DashboardSession =>
  ({ id, cwd: "/tmp/repo", source: "tui", status: "active", startedAt: 1, hidden: false, dataUnavailable: false, ...over }) as DashboardSession;
const item = (id: string): SessionListItem =>
  ({ ...row(id, { status: "ended" }), notifyLog: [{ x: 1 }], uiUrl: `http://x/session/${id}`, diffUrl: `http://x/session/${id}/diff` }) as unknown as SessionListItem;

const mapOf = (...ids: string[]) => new Map(ids.map((i) => [i, row(i)] as const));

interface Props {
  routeId: string | undefined;
  sessions: Map<string, DashboardSession>;
  gen: number;
  archived?: string;
}

function setup(initial: Props, lookup: (id: string) => Promise<SessionListItem[]>, navigate = vi.fn()) {
  const onAuthRequired = vi.fn();
  const seen: SessionRouteResolution[] = [];
  const order = new Map<string, string[]>();
  const endedTotals = new Map<string, number>();
  const hook = renderHook(
    (p: Props) => {
      // Lookup rows land in the sessions Map exactly as App does it.
      const [extra, setExtra] = useState<Map<string, DashboardSession>>(new Map());
      const [lookupOnly, setLookupOnly] = useState<Set<string>>(new Set());
      // A reconnect / server switch replaces the whole sessions Map (snapshot REPLACE).
      useEffect(() => {
        if (p.gen === 0) {
          setExtra(new Map());
          setLookupOnly(new Set());
        }
      }, [p.gen]);
      const sessions = mergeLookupRows(p.sessions, [...extra.values()]);
      const r = useSessionRouteResolution({
        routeId: p.routeId,
        sessions,
        snapshotGeneration: p.gen,
        archivedReadOnlyId: p.archived,
        mergeLookupRows: (rows) => {
          setExtra((prev) => mergeLookupRows(prev, rows));
          setLookupOnly((prev) => addLookupOnly(prev, rows.map((x) => x.id)));
        },
        onAuthRequired,
        lookup,
      });
      useVanishedRedirect(r.status, navigate);
      seen.push(r);
      return { r, sessions, lookupOnly };
    },
    { initialProps: initial },
  );
  return { ...hook, seen, onAuthRequired, navigate, order, endedTotals };
}

describe("useSessionRouteResolution", () => {
  it("F1: pending before the snapshot, then ok; never notFound; no lookup", async () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const h = setup({ routeId: "abc", sessions: new Map(), gen: 0 }, lookup);
    expect(h.result.current.r.status).toBe("pending");
    expect(h.result.current.r.canonicalId).toBeUndefined();
    h.rerender({ routeId: "abc", sessions: mapOf("abc"), gen: 1 });
    expect(h.result.current.r).toMatchObject({ status: "ok", canonicalId: "abc" });
    expect(h.seen.some((s) => s.status === "notFound")).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("F2: reconnect keeps the open session (sticky id, never pending/notFound/vanished)", () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const h = setup({ routeId: "abc", sessions: mapOf("abc"), gen: 1 }, lookup);
    h.seen.length = 0;
    h.rerender({ routeId: "abc", sessions: new Map(), gen: 0 });
    h.rerender({ routeId: "abc", sessions: mapOf("abc"), gen: 1 });
    expect(h.seen.length).toBeGreaterThan(0);
    for (const s of h.seen) {
      expect(s.canonicalId).toBe("abc");
      expect(["pending", "notFound", "vanished"]).not.toContain(s.status);
    }
  });

  it("F3a: archived while viewing → vanished only after the lookup is empty; navigate once", async () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const h = setup({ routeId: "abc", sessions: mapOf("abc"), gen: 1 }, lookup);
    h.rerender({ routeId: "abc", sessions: new Map(), gen: 1 });
    expect(h.result.current.r.status).toBe("ok"); // while the lookup is in flight
    await waitFor(() => expect(h.result.current.r.status).toBe("vanished"));
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("F3b: server switch to a server that lacks the id → vanished once the lookup is empty", async () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const h = setup({ routeId: "abc", sessions: mapOf("abc"), gen: 1 }, lookup);
    h.rerender({ routeId: "abc", sessions: new Map(), gen: 0 });
    expect(h.result.current.r.status).toBe("ok");
    h.rerender({ routeId: "abc", sessions: mapOf("other"), gen: 1 });
    await waitFor(() => expect(h.result.current.r.status).toBe("vanished"));
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("F4: an ended-but-retained row stays ok and does not navigate", () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const h = setup({ routeId: "abc", sessions: mapOf("abc"), gen: 1 }, lookup);
    h.rerender({ routeId: "abc", sessions: new Map([["abc", row("abc", { status: "ended" })]]), gen: 1 });
    expect(h.result.current.r.status).toBe("ok");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("F5: lookup merges a stripped row into sessions only; one fetch per connection", async () => {
    const lookup = vi.fn().mockResolvedValue([item("old1")]);
    const h = setup({ routeId: "old1", sessions: mapOf("live"), gen: 1 }, lookup);
    await waitFor(() => expect(h.result.current.r.status).toBe("ok"));
    expect(lookup).toHaveBeenCalledTimes(1);
    const merged = h.result.current.sessions.get("old1") as unknown as Record<string, unknown>;
    expect(merged).toBeDefined();
    expect("notifyLog" in merged || "uiUrl" in merged || "diffUrl" in merged).toBe(false);
    expect(h.result.current.lookupOnly.has("old1")).toBe(true);
    expect(h.order.size).toBe(0);
    expect(h.endedTotals.size).toBe(0);
    h.rerender({ routeId: "old1", sessions: mapOf("live"), gen: 1 });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("F6: reconnect while viewing a looked-up ended session issues a second lookup, keeps the id", async () => {
    const lookup = vi.fn().mockResolvedValue([item("old1")]);
    const h = setup({ routeId: "old1", sessions: mapOf("live"), gen: 1 }, lookup);
    await waitFor(() => expect(h.result.current.r.status).toBe("ok"));
    h.seen.length = 0;
    h.rerender({ routeId: "old1", sessions: new Map(), gen: 0 });
    h.rerender({ routeId: "old1", sessions: mapOf("live"), gen: 1 });
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    for (const s of h.seen) expect(s.canonicalId).toBe("old1");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("F7: a prefix that turns ambiguous before the replace effect flushes ends ambiguous", () => {
    const A = "01a16086-aaaa-4aaa-8aaa-000000000001";
    const B = "01a16086-bbbb-4bbb-8bbb-000000000002";
    const lookup = vi.fn().mockResolvedValue([]);
    const h = setup({ routeId: "01a16086", sessions: mapOf(A), gen: 1 }, lookup);
    expect(h.result.current.r.canonicalId).toBe(A);
    h.rerender({ routeId: "01a16086", sessions: mapOf(A, B), gen: 1 });
    expect(h.result.current.r.status).toBe("ambiguous");
    expect(h.result.current.r.candidates?.length).toBe(2);
    expect(h.result.current.r.canonicalId).toBeUndefined();
  });

  it("X1: network error then 503 → notFound(lookupFailed), no redirect, one fetch per retry", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockRejectedValueOnce(new Error("HTTP 503"));
    const h = setup({ routeId: "xxxxxxxx", sessions: mapOf("live"), gen: 1 }, lookup);
    await waitFor(() => expect(h.result.current.r.status).toBe("notFound"));
    expect(h.result.current.r.lookupFailed).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    act(() => h.result.current.r.retry());
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.result.current.r.lookupFailed).toBe(true));
    expect(h.result.current.r.status).toBe("notFound");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("X2: 401 then 403 → auth-loss handler, never notFound", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new SessionLookupAuthError(401))
      .mockRejectedValueOnce(new SessionLookupAuthError(403));
    const h = setup({ routeId: "xxxxxxxx", sessions: mapOf("live"), gen: 1 }, lookup);
    await waitFor(() => expect(h.onAuthRequired).toHaveBeenCalledTimes(1));
    act(() => h.result.current.r.retry());
    await waitFor(() => expect(h.onAuthRequired).toHaveBeenCalledTimes(2));
    expect(h.seen.some((s) => s.status === "notFound")).toBe(false);
  });
});

describe("useCanonicalRouteUrl", () => {
  const run = (args: Partial<Parameters<typeof useCanonicalRouteUrl>[0]>) => {
    const navigate = vi.fn();
    renderHook(() =>
      useCanonicalRouteUrl({
        status: "ok",
        canonicalId: "full-1",
        routeId: "full",
        view: undefined,
        search: "",
        navigate,
        ...args,
      }),
    );
    return navigate;
  };
  it("replaces a prefix URL with the canonical one, keeping view and query", () => {
    expect(run({ view: "diff", search: "embed=1" })).toHaveBeenCalledWith("/session/full-1/diff?embed=1", { replace: true });
    expect(run({})).toHaveBeenCalledWith("/session/full-1", { replace: true });
  });
  it("does nothing when already canonical or not ok", () => {
    expect(run({ routeId: "full-1" })).not.toHaveBeenCalled();
    expect(run({ status: "ambiguous", canonicalId: undefined })).not.toHaveBeenCalled();
  });
});
