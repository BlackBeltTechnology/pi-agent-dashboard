/**
 * Startup reconciliation of the persisted `sessionOrder` map under the
 * all-status model. Pure + side-effect free so it can be unit-tested without
 * a live server.
 *
 *   1. Prune stale ids — those no longer present in the session manager.
 *   2. Backfill ended ids that exist under a resolved key but are absent from
 *      the stored list, ordered by `(endedAt ?? startedAt)` desc (the old
 *      implicit ended-tier ordering), so pre-migration maps (which stripped
 *      ended ids) render identically on first load. Idempotent.
 *
 * See change: simplify-session-card-ordering.
 */
export interface ReconcileSession {
  id: string;
  status: string;
  endedAt?: number;
  startedAt: number;
}

/**
 * Compute the reconciled order map.
 *
 * @param orders     current persisted map: resolvedKey -> sessionId[]
 * @param sessions   every session known to the manager
 * @param resolveKey maps a session to its resolved order-map key
 * @returns          map of keys whose order CHANGED -> new id list (callers
 *                   persist only these via `reorder`)
 */
export function reconcileSessionOrder<T extends ReconcileSession>(
  orders: Record<string, string[]>,
  sessions: T[],
  resolveKey: (s: T) => string,
): Record<string, string[]> {
  const byId = new Map(sessions.map((s) => [s.id, s]));

  // Ended ids grouped by resolved key, most-recently-ended first.
  const endedByKey = new Map<string, string[]>();
  const endedSorted = sessions
    .filter((s) => s.status === "ended")
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  for (const s of endedSorted) {
    const key = resolveKey(s);
    const arr = endedByKey.get(key);
    if (arr) arr.push(s.id);
    else endedByKey.set(key, [s.id]);
  }

  const allKeys = new Set<string>([...Object.keys(orders), ...endedByKey.keys()]);
  const changes: Record<string, string[]> = {};
  for (const key of allKeys) {
    const stored = orders[key] ?? [];
    const pruned = stored.filter((id) => byId.has(id));
    const present = new Set(pruned);
    const backfill = (endedByKey.get(key) ?? []).filter((id) => !present.has(id));
    const next = [...pruned, ...backfill];
    const changed =
      next.length !== stored.length || next.some((id, i) => id !== stored[i]);
    if (changed) changes[key] = next;
  }
  return changes;
}
