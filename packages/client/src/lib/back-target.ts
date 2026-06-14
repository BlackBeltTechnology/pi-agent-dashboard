/**
 * Pure route → parent-route resolver for the depth-aware mobile back action.
 *
 * The MobileShell is depth-based (`getMobileDepth`: 0 = cards, 1 = detail,
 * 2 = overlay), but `window.history.back()` pops whatever URL preceded the
 * current one — not "one depth up". `computeBackTarget` derives the parent
 * route deterministically from the URL alone so one back press always moves
 * exactly one shell depth toward the card list.
 *
 * `routeDepth(url)` parses a URL string into `MobileDepthInput` and reuses
 * `getMobileDepth`, so depth derivation stays single-sourced. Used by both
 * this resolver and the in-app nav tracker.
 *
 * See change: fix-mobile-back-depth-aware.
 */
import { getMobileDepth, type MobileDepthInput } from "./mobile-depth.js";

/** Parse a URL string into the route-match flags `getMobileDepth` consumes. */
export function parseRouteDepthInput(url: string): MobileDepthInput {
  const [rawPath, queryStr] = url.split("?");
  const query = new URLSearchParams(queryStr ?? "");
  const segs = rawPath.split("/").filter(Boolean);

  const isSession = segs[0] === "session";
  const hasSessionRoute = isSession && segs.length === 2;
  const hasDiffRoute = isSession && segs.length === 3 && segs[2] === "diff";

  let hasFolderRoute = false;
  let hasFolderOverlay = false;
  if (segs[0] === "folder" && segs.length >= 3) {
    const sub = segs[2];
    if (segs.length === 3 && (sub === "terminals" || sub === "editor")) {
      hasFolderRoute = true;
    } else if (sub === "openspec") {
      // archive / specs / :changeName/:artifactId all count as overlay.
      hasFolderOverlay = true;
    } else if (segs.length === 3 && (sub === "readme" || sub === "pi-resources")) {
      hasFolderOverlay = true;
    } else if (segs.length === 3 && sub === "view" && !!query.get("path")) {
      hasFolderOverlay = true;
    }
  }

  const hasUrlViewRoute = segs[0] === "pi-view" && segs.length === 1 && !!query.get("url");
  const hasPiResourceRoute = segs[0] === "pi-resource" && segs.length === 1 && !!query.get("path");

  return {
    hasSessionRoute,
    hasFolderRoute,
    hasSettingsRoute: segs[0] === "settings",
    hasTunnelRoute: segs[0] === "tunnel-setup",
    hasOverlayRoute: hasDiffRoute || hasFolderOverlay || hasUrlViewRoute,
    hasPiResourceRoute,
  };
}

/** Derived MobileShell depth (0/1/2) for a URL string. */
export function routeDepth(url: string): number {
  return getMobileDepth(parseRouteDepthInput(url));
}

/**
 * Compute the route exactly one shell depth shallower, or null at depth 0.
 *
 * - depth 0 → null (no-op).
 * - depth 1 → "/" (cards).
 * - depth 2 `/session/:id/diff` → `/session/:id` (strip `/diff`).
 * - depth 2 ambiguous overlays (origin not encoded in URL) → "/".
 */
export function computeBackTarget(route: string): string | null {
  const depth = routeDepth(route);
  if (depth === 0) return null;
  if (depth === 1) return "/";

  // depth 2
  const [path] = route.split("?");
  const segs = path.split("/").filter(Boolean);
  if (segs[0] === "session" && segs.length === 3 && segs[2] === "diff") {
    return `/session/${segs[1]}`;
  }
  // Ambiguous overlays: launching detail not encoded in URL → cards floor.
  return "/";
}
