/**
 * Client-side goal-status derivation.
 *
 * The plugin server broadcasts each snapshot as a synthetic `goal_status`
 * dashboard event; the shell routes it into the plugin per-session event
 * store. `deriveSnapshot` folds that store to the latest snapshot — last
 * write wins. A `cleared` snapshot (or none) yields `null` so the chip and
 * predicate hide.
 *
 * See change: add-goal-continuation-plugin.
 */
import type { DashboardEvent, GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GOAL_STATUS_EVENT_TYPE, type GoalStatusSnapshot } from "../shared/goal-types.js";

export function deriveSnapshot(
  events: readonly DashboardEvent[],
): GoalStatusSnapshot | null {
  let latest: GoalStatusSnapshot | null = null;
  for (const ev of events) {
    if (ev.eventType !== GOAL_STATUS_EVENT_TYPE) continue;
    const d = ev.data as unknown as GoalStatusSnapshot;
    if (!d || typeof d.status !== "string") continue;
    latest = d;
  }
  if (!latest || latest.status === "cleared") return null;
  return latest;
}

/**
 * Resolve the turns numerator/denominator for a goal's gauge/ring. Live
 * snapshot wins; when the driver has ended (`snap === null`) it falls back to
 * the persisted `lastKnownTurnsUsed`. Denominator prefers the durable budget
 * cap, else the live `maxTurns`. `undefined` on either → render "—". `?? `
 * (not `||`) keeps a legitimate `0`. See change: fix-goal-detail-turns-and-spend.
 */
export function resolveGoalTurns(
  snap: Pick<GoalStatusSnapshot, "turnsUsed" | "maxTurns"> | null,
  goal: Pick<GoalRecord, "lastKnownTurnsUsed" | "budget">,
): { turnsUsed: number | undefined; maxTurns: number | undefined } {
  return {
    turnsUsed: snap?.turnsUsed ?? goal.lastKnownTurnsUsed,
    maxTurns: goal.budget?.maxTurns ?? snap?.maxTurns,
  };
}

/** Clamp a used/max ratio to a 0–100 width percent. */
export function gaugePct(used: number | undefined, max: number | undefined): number {
  if (used === undefined || !max || max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/** 2-decimal USD; absent/undefined → `$0.00`. See change:
 *  fix-goal-detail-turns-and-spend. */
export function fmtUsd(n: number | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}
