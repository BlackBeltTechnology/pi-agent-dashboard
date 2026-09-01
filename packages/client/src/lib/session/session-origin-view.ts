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
