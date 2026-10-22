/**
 * Resolves the `/session/:id[/diff|/editor]` route param to a canonical held
 * session id, with a server lookup for ids outside the windowed snapshot.
 *
 * The result is derived synchronously during render (never in an effect) so
 * subscription, history, drafts, mark-read, the viewed tracker and the diff
 * fetch never see a prefix, a mis-cased id or an id that is still unresolved.
 * `resolvedRef` / `wasHeldRef` are per route visit and sticky across
 * reconnects and server switches.
 *
 * Order (design D3): archived → held match → pre-snapshot (sticky or pending)
 * → one `GET /api/sessions?id=` per route id per connection → vanished /
 * notFound only after that lookup returned.
 *
 * See change: add-session-ui-deep-links-for-agents.
 */
import type { SessionListItem } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { type SessionUiView, sessionUiPath } from "@blackbelt-technology/pi-dashboard-shared/session-ui-path.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { lookupSessionsById, SessionLookupAuthError } from "../lib/api/sessions-lookup-api.js";
import { stripLookupRow } from "../lib/session/lookup-merge.js";
import { resolveSessionRouteId } from "../lib/session/resolve-session-route-id.js";

export type SessionRouteStatus = "none" | "pending" | "ok" | "ambiguous" | "notFound" | "vanished";

export interface SessionRouteResolution {
  status: SessionRouteStatus;
  /** Held (live-cased) full id; set only when `status === "ok"`. */
  canonicalId?: string;
  /** Held ids sharing the prefix; set only when `status === "ambiguous"`. */
  candidates?: string[];
  /** `notFound` because the lookup failed (network / 5xx), not because the id is unknown. */
  lookupFailed?: boolean;
  /** Re-run a failed lookup (exactly one new fetch). */
  retry: () => void;
}

interface Args {
  /** Raw id from the session / diff / editor route match; undefined off those routes. */
  routeId: string | undefined;
  sessions: Map<string, DashboardSession>;
  snapshotGeneration: number;
  archivedReadOnlyId: string | undefined;
  /** App merges stripped rows into `sessions` only and records them as lookup-only. */
  mergeLookupRows: (rows: DashboardSession[]) => void;
  /** 401 / 403 from the lookup → the existing auth-loss path. */
  onAuthRequired: () => void;
  /** Test seam. */
  lookup?: (id: string) => Promise<SessionListItem[]>;
}

type LookupState = "inflight" | "settled" | "failed" | "auth";

type RouteState = Omit<SessionRouteResolution, "retry">;

/**
 * The status decision, in design D3 order. Updates the per-visit sticky memory
 * (`resolved`, `wasHeld`) as a side effect on `visit` — only ever forward.
 */
function deriveRoute(a: {
  routeId: string | undefined;
  archivedReadOnlyId: string | undefined;
  match: ReturnType<typeof resolveSessionRouteId>;
  snapshotGeneration: number;
  lookup: LookupState | undefined;
  visit: { resolved?: string; wasHeld: boolean };
}): RouteState {
  const { routeId, archivedReadOnlyId, match, visit: v } = a;
  const sticky = (): RouteState =>
    v.resolved ? { status: "ok", canonicalId: v.resolved } : { status: "pending" };
  if (!routeId) return { status: "none" };
  if (archivedReadOnlyId) return { status: "ok", canonicalId: routeId };
  if (match.kind === "match") {
    v.resolved = match.id;
    v.wasHeld = true;
    return { status: "ok", canonicalId: match.id };
  }
  if (match.kind === "ambiguous") return { status: "ambiguous", candidates: match.candidates };
  if (a.snapshotGeneration === 0) return sticky();
  if (a.lookup === undefined || a.lookup === "inflight" || a.lookup === "auth") return sticky();
  if (a.lookup === "failed") return v.resolved ? sticky() : { status: "notFound", lookupFailed: true };
  return v.wasHeld ? { status: "vanished" } : { status: "notFound" };
}

export function useSessionRouteResolution({
  routeId,
  sessions,
  snapshotGeneration,
  archivedReadOnlyId,
  mergeLookupRows,
  onAuthRequired,
  lookup = lookupSessionsById,
}: Args): SessionRouteResolution {
  // Per route visit: last canonical id + whether it was ever held.
  const visit = useRef<{ routeId: string | undefined; resolved?: string; wasHeld: boolean }>({
    routeId,
    wasHeld: false,
  });
  if (visit.current.routeId !== routeId) visit.current = { routeId, wasHeld: false };
  const v = visit.current;

  // Connection epoch: bumps when this connection's snapshot first lands.
  const epochRef = useRef(0);
  const prevGenRef = useRef(snapshotGeneration);
  if (snapshotGeneration > 0 && prevGenRef.current === 0) epochRef.current += 1;
  prevGenRef.current = snapshotGeneration;

  const [lookups, setLookups] = useState<Record<string, LookupState>>({});
  const [retryNonce, setRetryNonce] = useState(0);
  const startedRef = useRef(new Set<string>());
  const latest = useRef({ mergeLookupRows, onAuthRequired, lookup });
  latest.current = { mergeLookupRows, onAuthRequired, lookup };

  const key = routeId ? `${epochRef.current}:${routeId}` : "";
  const match =
    routeId && !archivedReadOnlyId
      ? resolveSessionRouteId(routeId, sessions.keys())
      : ({ kind: "none" } as const);

  useEffect(() => {
    if (!routeId || archivedReadOnlyId || snapshotGeneration === 0 || match.kind !== "none") return;
    const token = `${key}#${retryNonce}`;
    if (startedRef.current.has(token)) return;
    startedRef.current.add(token);
    setLookups((p) => ({ ...p, [key]: "inflight" }));
    latest.current
      .lookup(routeId)
      .then((rows) => {
        const stripped = rows.map(stripLookupRow);
        if (stripped.length > 0) latest.current.mergeLookupRows(stripped);
        setLookups((p) => ({ ...p, [key]: "settled" }));
      })
      .catch((err: unknown) => {
        if (err instanceof SessionLookupAuthError) {
          setLookups((p) => ({ ...p, [key]: "auth" }));
          latest.current.onAuthRequired();
        } else {
          setLookups((p) => ({ ...p, [key]: "failed" }));
        }
      });
  }, [routeId, archivedReadOnlyId, snapshotGeneration, match.kind, key, retryNonce]);

  const retry = useCallback(() => {
    setLookups((p) => {
      const { [key]: _drop, ...rest } = p;
      return rest;
    });
    setRetryNonce((n) => n + 1);
  }, [key]);

  const derived = deriveRoute({ routeId, archivedReadOnlyId, match, snapshotGeneration, lookup: lookups[key], visit: v });
  return { ...derived, retry };
}

/**
 * `vanished` (the viewed session was archived, or a server switch landed on a
 * server that does not know it, and the lookup came back empty) keeps today's
 * redirect home — exactly once per transition.
 */
export function useVanishedRedirect(status: SessionRouteStatus, navigate: (to: string, opts?: { replace?: boolean }) => void): void {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (status === "vanished") navigateRef.current("/", { replace: true });
  }, [status]);
}

/**
 * When the resolved canonical id differs from the URL's (a prefix, or a
 * different case), converge the URL — same view suffix, same query — with
 * REPLACE so the history stack gains no entry for the short form.
 */
export function useCanonicalRouteUrl(args: {
  status: SessionRouteStatus;
  canonicalId: string | undefined;
  routeId: string | undefined;
  view: SessionUiView | undefined;
  /** Search string without the leading `?`. */
  search: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}): void {
  const { status, canonicalId, routeId, view, search, navigate } = args;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (status !== "ok" || !canonicalId || !routeId || canonicalId === routeId) return;
    const q = search ? `?${search.replace(/^\?/, "")}` : "";
    navigateRef.current(`${sessionUiPath(canonicalId, view)}${q}`, { replace: true });
  }, [status, canonicalId, routeId, view, search]);
}
