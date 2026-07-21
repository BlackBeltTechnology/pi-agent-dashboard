/**
 * Depth-aware back-arrow helper for shell overlays + mobile back/swipe.
 *
 * The MobileShell is depth-based (`getMobileDepth`: 0 = cards, 1 = detail,
 * 2 = overlay), but `window.history.back()` pops whatever URL preceded the
 * current one — which after a window has been in use is commonly a sibling
 * `/session/:id` (walks sibling chats) or a foreign page (escapes the app).
 * The old `history.length > 1` guard was unsound: length > 1 ≠ predecessor
 * belongs to the dashboard.
 *
 * `goBack` is hybrid:
 *   - If the in-app nav tracker proves the predecessor is a strictly-shallower
 *     in-app route, use `window.history.back()` (preserves scroll restoration +
 *     forward entry) and pop the tracked stack.
 *   - Otherwise navigate explicitly to `computeBackTarget(currentRoute)` — one
 *     deterministic depth up. Covers cold-load / deep-link (no predecessor) and
 *     same-depth-sibling predecessors.
 *   - Depth 0 → no-op.
 *
 * See change: fix-mobile-back-depth-aware (replaces `goBackOrHome` from
 * overlay-url-routing).
 */
import { computeBackTarget, routeDepth, isModalRoute } from "./back-target.js";
import type { NavEntry } from "./nav-tracker.js";

export interface BackTracker {
  predecessor(): NavEntry | undefined;
  popNav(): void;
}

export function goBack(
  navigate: (to: string) => void,
  currentRoute: string,
  tracker: BackTracker,
): void {
  const currentDepth = routeDepth(currentRoute);
  if (currentDepth === 0) return;

  const pred = tracker.predecessor();

  // Modal routes (settings / tunnel-setup) are entered from a launching route
  // and must return to it. They are same-depth (1) with their launcher, so the
  // shallower-only fast-path below never fires for them; consult the tracked
  // predecessor directly. A tracked predecessor is by construction in-app, so
  // history.back() is safe and preserves scroll/forward. No predecessor
  // (cold-load / deep-link) falls through to computeBackTarget → "/".
  // See change: fix-settings-back-to-launching-route.
  if (isModalRoute(currentRoute) && pred) {
    window.history.back();
    tracker.popNav();
    return;
  }

  if (pred && pred.depth < currentDepth) {
    window.history.back();
    tracker.popNav();
    return;
  }

  const target = computeBackTarget(currentRoute);
  if (target) navigate(target);
}
