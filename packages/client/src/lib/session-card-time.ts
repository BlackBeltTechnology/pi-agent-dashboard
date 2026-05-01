import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Pick the timestamp the session-card relative-time badge should anchor to.
 *
 * Precedence:
 *  - `status === "ended"` → `endedAt` (then `lastActivityAt`, then `startedAt`)
 *  - else → `lastActivityAt ?? startedAt`
 *
 * `lastActivityAt` is server-stamped on activity events (`isActivityEvent`)
 * and seeded at server start from the events.jsonl mtime, so a fresh dashboard
 * does not "reset" all idle session badges to "0s".
 *
 * See change: session-card-last-activity-badge (design.md § "Render precedence").
 */
export function selectBadgeTimestamp(session: DashboardSession): number {
  if (session.status === "ended") {
    return session.endedAt ?? session.lastActivityAt ?? session.startedAt;
  }
  return session.lastActivityAt ?? session.startedAt;
}
