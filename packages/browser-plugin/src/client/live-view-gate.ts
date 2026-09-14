/**
 * Manifest-level predicate for the `content-view` claim (`LiveViewTile`).
 *
 * content-view claims MUST be predicate-gated (see
 * shared/src/__tests__/content-view-claims-predicated.test.ts): an ungated
 * claim renders for every session and occludes the chat.
 *
 * A predicate cannot use hooks, and the relay protocol is GLOBAL (no pi-session
 * linkage), so the answer comes from the module-level relay store, which an
 * always-mounted subscriber (`BrowserRelayBadge`) feeds over the shell WS.
 * `setRelayStatus` bumps the slot-claims version on a material change, which is
 * what re-renders the content-view slot and re-evaluates this predicate.
 *
 * See change: add-browser-relay (task 4.3).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { hasLiveInstance } from "./relay-store.js";

// The session arg is ignored on purpose: the relay is global, not per-session.
export function isLiveViewActive(_session?: DashboardSession | null): boolean {
  return hasLiveInstance();
}
