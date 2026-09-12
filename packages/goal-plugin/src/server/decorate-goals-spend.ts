/**
 * decorate-goals-spend — the single server-side choke point that joins each
 * `GoalRecord` with its total USD spend (`Σ DashboardSession.cost` over the
 * goal's `sessionIds`) at read time.
 *
 * PURE by contract: returns NEW record objects (`{ ...g, totalSpendUsd }`) and
 * NEVER mutates an input in place. This purity is load-bearing, not stylistic —
 * `goal-store.ts` create/update/link/unlink return a `result` reference that is
 * ALSO the object stored in the write-through cache, so an in-place
 * `g.totalSpendUsd = …` would be persisted to `<folderHash>.json` on the next
 * write. A pure map can never touch the cache.
 *
 * Robust: a session that does not resolve, has no `cost`, or whose lookup throws
 * contributes `0` — one bad id never propagates a 5xx to the list/broadcast.
 *
 * `totalSpendUsd` is server-derived at read time, never persisted, never
 * bridge-sent — same convention as the server-joined `groupId`.
 *
 * See change: fix-goal-detail-turns-and-spend.
 */
import type { GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Minimal read surface this helper needs from the SessionManager. */
export interface SpendSessionLookup {
  get(sessionId: string): { cost?: number } | undefined;
}

/** Sum the guarded per-session cost over a goal's linked sessions. */
function sumSpend(sessionIds: readonly string[], sessions: SpendSessionLookup): number {
  let total = 0;
  for (const sid of sessionIds) {
    try {
      total += sessions.get(sid)?.cost ?? 0;
    } catch {
      // Unresolvable / throwing lookup contributes 0 — never propagates.
    }
  }
  return total;
}

/**
 * Return new `GoalRecord` objects each carrying a read-time `totalSpendUsd`.
 * Input records are never mutated.
 */
export function decorateGoalsWithSpend(goals: GoalRecord[], sessions: SpendSessionLookup): GoalRecord[] {
  return goals.map((g) => ({ ...g, totalSpendUsd: sumSpend(g.sessionIds, sessions) }));
}
