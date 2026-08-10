/**
 * Pure route → depth/parent resolver for the depth-aware back action.
 *
 * The MobileShell is depth-based (`getMobileDepth`: 0 = cards, 1 = detail,
 * 2 = overlay), but `window.history.back()` pops whatever URL preceded the
 * current one — not "one depth up". `computeBackTarget` derives the parent
 * route deterministically from the URL alone so one back press always moves
 * exactly one shell depth toward the card list.
 *
 * Route depth + parent are resolved from an ordered `RouteDescriptor` table —
 * NOT a hardcoded switch. The table is the union of (a) static descriptors for
 * core routes and (b) descriptors contributed by plugin `shell-overlay-route`
 * claims (registered at boot via `registerPluginRouteDescriptors`). Resolution
 * is most-specific-first, first-match-wins. A URL with no matching descriptor
 * resolves to depth 0 (card list).
 *
 * Making the table data-driven is what lets plugin overlay routes resolve to a
 * defined depth instead of the old depth-0 dead no-op: the classifier was never
 * starved of correctness, only of route knowledge.
 *
 * See change: fix-mobile-back-depth-aware, fix-plugin-and-scoped-back-navigation.
 */
import type { RouteDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/route-descriptor.js";
import type { MobileDepthInput } from "../layout/mobile-depth.js";

export type { RouteDescriptor };

/**
 * Static descriptor with optional client-only match refinements the shared
 * `RouteDescriptor` shape does not carry (query-param gating). Plugin
 * descriptors are plain `RouteDescriptor`s.
 */
interface StaticRouteDescriptor extends RouteDescriptor {
  /** Match only when this query param is present and non-empty. */
  requireQuery?: string;
}

/** Parent one depth up for a `/…/:id/diff`-style route: strip the trailing segment. */
function parentSession(params: Record<string, string>): string {
  return `/session/${params.id}`;
}

/**
 * Core static descriptors — a behavior-preserving migration of the prior
 * hardcoded switch. Ordered most-specific-first for readability; the resolver
 * sorts by specificity regardless.
 */
const STATIC_DESCRIPTORS: StaticRouteDescriptor[] = [
  // depth 2 — session diff + internal Monaco editor pane (parents URL-computable).
  { pattern: "/session/:id/diff", depth: 2, computeParent: parentSession },
  { pattern: "/session/:id/editor", depth: 2, computeParent: parentSession },
  // depth 2 — ambiguous overlays (launching detail not encoded in URL) → cards.
  { pattern: "/folder/:cwd/openspec/*", depth: 2 },
  { pattern: "/folder/:cwd/pi-resources", depth: 2 },
  { pattern: "/folder/:cwd/view", depth: 2, requireQuery: "path" },
  { pattern: "/pi-view", depth: 2, requireQuery: "url" },
  { pattern: "/pi-resource", depth: 2, requireQuery: "path" },
  // depth 1 — details / modals → cards.
  { pattern: "/session/:id", depth: 1 },
  // Bare directory home page. Less specific than the deeper folder routes
  // below (1 literal vs 2), so the resolver ranks those first; the exact
  // segment-count match keeps this from shadowing them. See change:
  // add-directory-home-page.
  { pattern: "/folder/:cwd", depth: 1 },
  { pattern: "/folder/:cwd/terminals", depth: 1 },
  { pattern: "/folder/:cwd/editor", depth: 1 },
  { pattern: "/folder/:cwd/settings", depth: 1 },
  { pattern: "/folder/:cwd/settings/:page", depth: 1 },
  { pattern: "/settings", depth: 1 },
  { pattern: "/settings/:page", depth: 1 },
  { pattern: "/tunnel-setup", depth: 1 },
];

/** Plugin-contributed descriptors, registered at app boot. */
let pluginDescriptors: RouteDescriptor[] = [];

/**
 * Register the descriptors contributed by plugin `shell-overlay-route` claims.
 * Called once at app boot from the module that builds the plugin registry.
 * Merged (static ∪ plugin) into the classifier table. A dev-time warning fires
 * when two descriptors share a pattern (a plugin shadowing a core route, or two
 * plugins colliding).
 */
export function registerPluginRouteDescriptors(descriptors: RouteDescriptor[]): void {
  pluginDescriptors = descriptors;
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    const seen = new Set<string>();
    for (const d of [...STATIC_DESCRIPTORS, ...descriptors]) {
      if (seen.has(d.pattern)) {
        // eslint-disable-next-line no-console
        console.warn(`[back-target] duplicate route descriptor pattern: ${d.pattern}`);
      }
      seen.add(d.pattern);
    }
  }
}

/** Number of literal (non-`:param`, non-`*`) segments — the specificity score. */
function literalSegmentCount(pattern: string): number {
  return pattern
    .split("/")
    .filter(Boolean)
    .filter((s) => !s.startsWith(":") && s !== "*").length;
}

/**
 * Match a wouter-style `pattern` against path segments. Supports `:param`
 * (captures one decoded segment) and a trailing `*` (matches zero or more
 * remaining segments). Returns captured params on match, `null` on miss.
 */
function matchPattern(pattern: string, segs: string[]): Record<string, string> | null {
  const pat = pattern.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i]!;
    if (p === "*") return params; // trailing wildcard — rest matches
    if (i >= segs.length) return null;
    const s = segs[i]!;
    if (p.startsWith(":")) {
      try {
        params[p.slice(1)] = decodeURIComponent(s);
      } catch {
        params[p.slice(1)] = s;
      }
      continue;
    }
    if (p !== s) return null;
  }
  return pat.length === segs.length ? params : null;
}

interface Resolved {
  descriptor: StaticRouteDescriptor | RouteDescriptor;
  params: Record<string, string>;
}

/**
 * Resolve a URL to the matching descriptor, most-specific-first, first-match.
 * Specificity = literal-segment count (desc), then total segment count (desc),
 * then registration order (static before plugin). Returns `null` when nothing
 * matches (depth 0 / card list).
 */
function resolveDescriptor(url: string): Resolved | null {
  const [rawPath, queryStr] = url.split("?");
  const segs = rawPath.split("/").filter(Boolean);
  const query = new URLSearchParams(queryStr ?? "");

  const table: (StaticRouteDescriptor | RouteDescriptor)[] = [
    ...STATIC_DESCRIPTORS,
    ...pluginDescriptors,
  ];
  const ranked = table
    .map((descriptor, order) => ({
      descriptor,
      order,
      literals: literalSegmentCount(descriptor.pattern),
      total: descriptor.pattern.split("/").filter(Boolean).length,
    }))
    .sort((a, b) => b.literals - a.literals || b.total - a.total || a.order - b.order);

  for (const { descriptor } of ranked) {
    const requireQuery = (descriptor as StaticRouteDescriptor).requireQuery;
    if (requireQuery && !query.get(requireQuery)) continue;
    const params = matchPattern(descriptor.pattern, segs);
    if (params) return { descriptor, params };
  }
  return null;
}

/**
 * Parse a URL string into the route-match flags `getMobileDepth` consumes.
 *
 * Retained for backward compatibility (public signature unchanged); `routeDepth`
 * now resolves depth via the descriptor table. `getMobileDepth` is still used
 * directly by the shell for render depth. See change:
 * fix-plugin-and-scoped-back-navigation.
 */
export function parseRouteDepthInput(url: string): MobileDepthInput {
  const [rawPath, queryStr] = url.split("?");
  const query = new URLSearchParams(queryStr ?? "");
  const segs = rawPath.split("/").filter(Boolean);

  const isSession = segs[0] === "session";
  const hasSessionRoute = isSession && segs.length === 2;
  const hasDiffRoute = isSession && segs.length === 3 && segs[2] === "diff";

  let hasFolderRoute = false;
  let hasFolderOverlay = false;
  let hasFolderSettingsRoute = false;
  if (segs[0] === "folder" && segs.length === 2) {
    // Bare directory home page — depth-1 detail. See change:
    // add-directory-home-page.
    hasFolderRoute = true;
  }
  if (segs[0] === "folder" && segs.length >= 3) {
    const sub = segs[2];
    if (segs.length === 3 && (sub === "terminals" || sub === "editor")) {
      hasFolderRoute = true;
    } else if (sub === "settings") {
      hasFolderSettingsRoute = true;
    } else if (sub === "openspec") {
      hasFolderOverlay = true;
    } else if (segs.length === 3 && sub === "pi-resources") {
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
    hasFolderSettingsRoute,
    hasTunnelRoute: segs[0] === "tunnel-setup",
    hasOverlayRoute: hasDiffRoute || hasFolderOverlay || hasUrlViewRoute,
    hasPiResourceRoute,
  };
}

/** Derived MobileShell depth (0/1/2) for a URL string, via the descriptor table. */
export function routeDepth(url: string): number {
  return resolveDescriptor(url)?.descriptor.depth ?? 0;
}

/**
 * True for *modal* routes — full-screen routes entered from a launching route
 * and expected to return to it (`/settings`, `/settings/:page`, `/tunnel-setup`).
 * Distinct from *lateral* depth-1 routes (session / folder) whose back goes to
 * the card list. Used by `goBack` to prefer the tracked in-app predecessor for
 * same-depth modals. See change: fix-settings-back-to-launching-route.
 */
export function isModalRoute(url: string): boolean {
  const [rawPath] = url.split("?");
  const first = rawPath.split("/").filter(Boolean)[0];
  return first === "settings" || first === "tunnel-setup";
}

/**
 * Compute the route exactly one shell depth shallower, or null at depth 0.
 *
 * Returns the matched descriptor's `computeParent(params, url)` when declared,
 * otherwise the depth default:
 *   - depth 0 → null (no-op).
 *   - depth 1 → "/" (cards).
 *   - depth 2 → "/" (ambiguous overlay floor) unless a `computeParent` narrows it.
 */
export function computeBackTarget(route: string): string | null {
  const resolved = resolveDescriptor(route);
  if (!resolved) return null;
  const { descriptor, params } = resolved;
  if (descriptor.depth === 0) return null;
  if (descriptor.computeParent) return descriptor.computeParent(params, route);
  return "/";
}
