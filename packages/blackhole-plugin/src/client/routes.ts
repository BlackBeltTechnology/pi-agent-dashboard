/** Route paths shared by the blackhole plugin's client modules. */

/** Installed-check route (design D1) — consumed by the boot gate + settings. */
export const STATUS_ROUTE = "/api/plugins/blackhole/status";
/** Per-session pipeline route (design D5) — consumed by the MEMORY subcard. */
const SESSION_ROUTE_BASE = "/api/plugins/blackhole/session";

export function sessionRoute(sessionId: string): string {
  return `${SESSION_ROUTE_BASE}/${encodeURIComponent(sessionId)}`;
}
