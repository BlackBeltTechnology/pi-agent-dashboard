/**
 * Manifest-level predicate for the `content-view` claim (`LiveViewTile`).
 *
 * content-view claims MUST be predicate-gated (see
 * shared/src/__tests__/content-view-claims-predicated.test.ts): an ungated
 * claim renders for every session and occludes the chat. The real gate —
 * "this session has a live browser-relay instance with a screencast tile" —
 * lands with workstream 4 (client) on top of workstream 2c's
 * `browser_relay_status`; until then the tile never renders.
 *
 * See change: add-browser-relay (task 2.1 scaffold).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function isLiveViewActive(_session?: DashboardSession | null): boolean {
  return false;
}
