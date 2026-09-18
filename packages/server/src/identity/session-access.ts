/**
 * Owner-equality gate for every session read/write road (openspec §8 / design
 * D11). One predicate, applied uniformly at HTTP routes, WS bootstrap/list,
 * subscribe/replay, and every inbound session command, so a new road cannot
 * silently skip the check.
 *
 * Semantics:
 *   - INERT (no active resolver) ⇒ always allow — byte-for-byte today's
 *     behavior. The identity plane is opt-in.
 *   - ACTIVE + ownerless session ⇒ deny. An ownerless session
 *     (scheduler/automation, inert-era) is invisible and immutable to human
 *     principals (D11); every browser socket carries a principal when active
 *     (§9.2), so these are simply unreachable by humans.
 *   - ACTIVE + principal-less requester ⇒ deny. A socket/request with no
 *     principal is refused every owned session.
 *   - ACTIVE + owned ⇒ allow ONLY on exact `(iss, sub)` equality — no
 *     normalization, no email fallback, no object identity.
 */

import { principalEquals } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export interface SessionAccessInput {
  /** Is a trusted+configured principal resolver active? */
  active: boolean;
  /** The requester's resolved principal (socket/request), or null when absent. */
  principal: { iss: string; sub: string } | null | undefined;
  /** The session's persisted owner, or undefined when ownerless. */
  owner: { iss: string; sub: string } | null | undefined;
}

/** True when the requester may read or write this session. */
export function canAccessSession(input: SessionAccessInput): boolean {
  if (!input.active) return true; // inert era — unchanged
  if (!input.owner) return false; // ownerless ⇒ invisible/immutable to humans
  if (!input.principal) return false; // principal-less requester ⇒ refused
  return principalEquals(input.owner, input.principal);
}

interface OwnedSession {
  id: string;
  principalOwner?: { iss: string; sub: string };
}

/**
 * Owner-gate an HTTP session road (§8.1). Reads the request principal set by
 * the resolver hook (§4) and the session's owner. On deny, replies `404` — the
 * same "invisible" refusal for a non-owner, a principal-less requester, and an
 * ownerless session, so the route hands back no owned-vs-not-found oracle.
 * Returns `true` to proceed. Inert era always proceeds.
 */
export function gateHttpSession(
  reply: { code(status: number): unknown },
  active: boolean,
  principal: { iss: string; sub: string } | null | undefined,
  owner: { iss: string; sub: string } | null | undefined,
): boolean {
  if (canAccessSession({ active, principal, owner })) return true;
  reply.code(404);
  return false;
}

interface OwnedSnapshot<S extends OwnedSession> {
  sessions: S[];
  orders: Record<string, string[]>;
  endedTotals: Record<string, number>;
}

/**
 * Filter a bootstrap/list snapshot to the sessions a principal owns (§8.2).
 * Per-ITEM filtering — never authorize the container then return other owners'
 * sessions. When inert the snapshot passes through unchanged.
 *
 * - `sessions`: kept only when {@link canAccessSession} allows.
 * - `orders`: each group's id list is filtered to the visible set; empty groups
 *   are dropped so no dangling id references a hidden session.
 * - `endedTotals`: kept only for groups that still have a visible session, so a
 *   human never learns the ended-count of a group it has no presence in.
 */
export function filterSnapshotForPrincipal<S extends OwnedSession>(
  snapshot: OwnedSnapshot<S>,
  active: boolean,
  principal: { iss: string; sub: string } | null | undefined,
): OwnedSnapshot<S> {
  if (!active) return snapshot;
  const sessions = snapshot.sessions.filter((s) =>
    canAccessSession({ active, principal, owner: s.principalOwner }),
  );
  const visibleIds = new Set(sessions.map((s) => s.id));
  const orders: Record<string, string[]> = {};
  for (const [group, ids] of Object.entries(snapshot.orders)) {
    const kept = ids.filter((id) => visibleIds.has(id));
    if (kept.length > 0) orders[group] = kept;
  }
  const endedTotals: Record<string, number> = {};
  for (const group of Object.keys(orders)) {
    if (snapshot.endedTotals[group] !== undefined) endedTotals[group] = snapshot.endedTotals[group];
  }
  return { ...snapshot, sessions, orders, endedTotals };
}
