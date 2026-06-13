/**
 * Slot-claim predicate for the goal-plugin.
 *
 * `hasGoal` reads the plugin per-session event store synchronously (safe
 * outside React) so the `session-card-badge` slot only mounts `GoalChip`
 * when an active/paused/done snapshot exists. Mirrors the jj-plugin
 * `isInJjWorkspace` predicate pattern.
 *
 * See change: add-goal-continuation-plugin.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime";
import { deriveSnapshot } from "./goal-state.js";

export function hasGoal(session: DashboardSession | null | undefined): boolean {
  if (!session?.id) return false;
  return deriveSnapshot(getSessionEvents(session.id)) !== null;
}
