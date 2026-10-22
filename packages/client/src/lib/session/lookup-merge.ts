/**
 * Shape + merge rules for session rows fetched by `GET /api/sessions?id=`.
 * Rows are stripped to the snapshot / page row shape (no `notifyLog`,
 * `uiUrl`, `diffUrl`) and merged into the `sessions` Map ONLY — never into
 * the order map, `endedTotals` or paging state. Their ids join a lookup-only
 * set that the held-ended count excludes until a page or snapshot delivers them.
 * See change: add-session-ui-deep-links-for-agents (D3).
 */
import type { SessionListItem } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function stripLookupRow(row: SessionListItem): DashboardSession {
  const { notifyLog: _n, uiUrl: _u, diffUrl: _d, ...rest } = row as SessionListItem & { notifyLog?: unknown };
  return rest as DashboardSession;
}

/** Overwrite-by-id merge of looked-up rows into the sessions Map. */
export function mergeLookupRows(
  prev: Map<string, DashboardSession>,
  rows: DashboardSession[],
): Map<string, DashboardSession> {
  if (rows.length === 0) return prev;
  const next = new Map(prev);
  for (const r of rows) next.set(r.id, r);
  return next;
}

/** Add ids to the lookup-only set (reference-stable when nothing changes). */
export function addLookupOnly(prev: Set<string>, ids: string[]): Set<string> {
  if (ids.every((id) => prev.has(id))) return prev;
  const next = new Set(prev);
  for (const id of ids) next.add(id);
  return next;
}

/** Drop ids a page/snapshot has now delivered (reference-stable when nothing changes). */
export function removeLookupOnly(prev: Set<string>, ids: Iterable<string>): Set<string> {
  let next: Set<string> | null = null;
  for (const id of ids) {
    if (prev.has(id)) {
      next ??= new Set(prev);
      next.delete(id);
    }
  }
  return next ?? prev;
}
