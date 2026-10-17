/**
 * Transport/identity view helpers for a `DashboardSession`.
 *
 * Two optional server-set fields drive the client surface:
 *   - `originDeviceId` — set only when the session's bridge was REMOTE.
 *     ABSENT MEANS LOCAL; every pre-existing session relies on that encoding,
 *     so absence must never be read as remote.
 *   - `movedTo` — set when the session moved to another dashboard instance.
 *     `status` deliberately stays `"ended"` (no `"moved"` member was added to
 *     the `SessionStatus` union), so "moved" is a `movedTo` test, not a status
 *     test.
 *
 * See change: add-pi-gateway-transport-identity.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** True when the session's bridge ran on another host. */
export function isRemoteOrigin(session: DashboardSession): boolean {
  return Boolean(session.originDeviceId);
}

/** True when the session moved to another dashboard instance. */
export function hasMovedAway(session: DashboardSession): boolean {
  return Boolean(session.movedTo);
}

/**
 * True when ANY session chip (Moved / Origin device / ACP driver) renders on the
 * desktop card's meta row. The row gate and the chips share these predicates, so
 * they cannot disagree. See change: compact-session-card-header (D8).
 */
export function metaChipsVisible(session: DashboardSession): boolean {
  return hasMovedAway(session) || isRemoteOrigin(session) || isAcpSession(session);
}

/**
 * True for an ACP-agent session. Pi-only controls (Resume, Fork, Reload, Retry,
 * flows, terminal, file listing) are HIDDEN for it — removed, not shown then
 * refused (Nielsen H5). Absent `driver` ≡ pi.
 * See change: add-acp-session-driver (D12, mockup S2).
 */
export function isAcpSession(session: Pick<DashboardSession, "driver">): boolean {
  return session.driver === "acp";
}
