/**
 * The overlay's pinned background location.
 *
 * A route-backed overlay points the URL at itself, so the launching route stops
 * matching and cannot render from `window.location`. Design D1 (option C)
 * resolves this by FREEZING the launching location at navigation time and
 * rendering the underlay from that frozen path through a wouter `<Router hook>`
 * that is independent of `window.location`.
 *
 * This module owns only the pure resolution:
 *   - `captureBackground(url)` records the location being left, once;
 *   - `resolveBackground(currentRoute)` returns what the underlay should render,
 *     preferring the capture and falling back to `computeBackTarget` on a cold
 *     load (`page.goto("/settings/security")` — nothing was captured).
 *
 * The capture is deliberately NOT refreshed while an overlay is open: an
 * in-overlay navigation (settings → plugin settings) must leave the underlay and
 * the dismissal target alone, or one `Esc` would land mid-surface instead of
 * back at the launching route.
 *
 * Both halves of the location are pinned. Three converted routes carry query
 * strings (`/folder/:cwd/view?path=`, `/pi-view?url=`, `/pi-resource?path=`), so
 * pinning the path while letting the search string come from the live location
 * would render a frozen path against the overlay's own query.
 *
 * See change: add-route-backed-overlay-dialogs (D1, test-plan S-08 / S-08b).
 */
import { computeBackTarget, isModalRoute } from "./back-target.js";

export interface BackgroundLocation {
  /** Path half, no query, no hash. */
  path: string;
  /** Query half WITHOUT the leading "?" — wouter's `searchHook` shape. */
  search: string;
}

export interface ResolvedBackground extends BackgroundLocation {
  /** `captured` = frozen at navigation time; `synthesized` = cold-load fallback. */
  source: "captured" | "synthesized";
}

/** Split a URL into wouter's `(path, search)` pair, discarding any hash. */
export function splitLocation(url: string): BackgroundLocation {
  const [beforeHash] = url.split("#");
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return { path: beforeHash, search: "" };
  return {
    path: beforeHash.slice(0, queryAt),
    search: beforeHash.slice(queryAt + 1),
  };
}

let captured: BackgroundLocation | undefined;

/**
 * Freeze `url` as the background for the next overlay.
 *
 * An overlay route is never captured as its own background — that would render
 * the overlay behind itself and make dismissal a no-op.
 */
export function captureBackground(url: string): void {
  const location = splitLocation(url);
  if (isOverlayRoute(location.path)) return;
  captured = location;
}

/** The current capture, or `undefined` when nothing is frozen. */
export function peekBackground(): BackgroundLocation | undefined {
  return captured;
}

/** Drop the capture so the next overlay re-captures (called on dismissal). */
export function clearBackground(): void {
  captured = undefined;
}

/**
 * What the underlay should render beneath `currentRoute`.
 *
 * Prefers the frozen capture. On a cold load there is none, so the background is
 * synthesized from the descriptor table — the same `depth`/`parentPath`
 * declarations that drive the back action, which is why group 2's fixes are
 * load-bearing on this path too.
 */
export function resolveBackground(currentRoute: string): ResolvedBackground {
  if (captured) return { ...captured, source: "captured" };

  const target = computeBackTarget(currentRoute);
  const fallback = splitLocation(target ?? "/");
  // A self-referential underlay would render the overlay behind itself.
  if (fallback.path === splitLocation(currentRoute).path) {
    return { path: "/", search: "", source: "synthesized" };
  }
  return { ...fallback, source: "synthesized" };
}

/**
 * Routes that are themselves route-backed overlays and so can never serve as a
 * background — the seven surfaces the `url-routing` spec lists as converted.
 *
 * Deliberately NOT `isModalRoute`. That predicate knows only `/settings/*` and
 * `/tunnel-setup` because it answers a different question (which routes the
 * mobile back path treats as modal), and widening it would change history
 * semantics for every caller. The two lists overlap; they are not the same list.
 *
 * A route missing here captures ITSELF as its background: it renders behind
 * itself and dismissal becomes a no-op.
 */
export function isOverlayRoute(path: string): boolean {
  if (isModalRoute(path)) return true;
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "pi-view" || segments[0] === "pi-resource") return true;
  if (segments[0] !== "folder") return false;
  // `/folder/:cwd/settings[/:page]`
  if (segments[2] === "settings") return true;
  // `/folder/:cwd/view`
  if (segments[2] === "view") return true;
  // `/folder/:cwd/openspec/:changeName/:artifactId` — the artifact preview only.
  // The board (`/openspec`) and its `archive` / `specs` pages stay full pages,
  // so they remain valid backgrounds.
  if (segments[2] === "openspec" && segments.length === 5) return true;
  return false;
}
