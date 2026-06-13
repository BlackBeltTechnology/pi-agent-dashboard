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
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
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
