/**
 * Pure matching of a `/session/:id` route param against held session ids
 * (design D4). Exact raw match wins; else case-insensitive exact; else, for
 * ids of >= 8 characters, a unique case-insensitive prefix. The result always
 * carries the HELD (live-cased) id. The server `?id=` lookup applies the same
 * 8-character floor and lowercasing.
 * See change: add-session-ui-deep-links-for-agents.
 */
const MIN_SESSION_PREFIX = 8;

export type SessionRouteMatch =
  | { kind: "match"; id: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

export function resolveSessionRouteId(routeId: string, ids: Iterable<string>): SessionRouteMatch {
  const held = [...ids];
  if (held.includes(routeId)) return { kind: "match", id: routeId };
  const lower = routeId.toLowerCase();
  const ci = held.find((id) => id.toLowerCase() === lower);
  if (ci !== undefined) return { kind: "match", id: ci };
  if (lower.length < MIN_SESSION_PREFIX) return { kind: "none" };
  const prefixed = held.filter((id) => id.toLowerCase().startsWith(lower));
  if (prefixed.length === 1) return { kind: "match", id: prefixed[0] as string };
  if (prefixed.length > 1) return { kind: "ambiguous", candidates: prefixed };
  return { kind: "none" };
}
