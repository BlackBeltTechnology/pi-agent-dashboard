/**
 * Shared route descriptor for the depth-aware back action.
 *
 * The client's back-target classifier resolves route depth + parent from an
 * ordered `RouteDescriptor` table. Core routes contribute static descriptors;
 * plugin `shell-overlay-route` claims contribute descriptors emitted by the
 * plugin runtime. Defined here so both packages share ONE definition without a
 * client↔runtime dependency cycle (client and runtime both depend on shared;
 * neither depends on the other for this type).
 *
 * See change: fix-plugin-and-scoped-back-navigation.
 */
export interface RouteDescriptor {
  /** Wouter-style path pattern, e.g. "/folder/:encodedCwd/automations". */
  pattern: string;
  /** Shell navigation depth: 0 = cards, 1 = detail, 2 = overlay. */
  depth: 0 | 1 | 2;
  /**
   * Optional parent-route resolver. Receives the matched `:params` (decoded)
   * plus the full current URL; returns the route exactly one depth shallower,
   * or `null` for a no-op. When omitted, the classifier applies the depth
   * default (depth 1 → "/", depth 2 → "/").
   */
  computeParent?: (params: Record<string, string>, url: string) => string | null;
}

/**
 * Interpolate a wouter-style `parentPath` pattern's `:params` from a match's
 * params. Each interpolated value is re-encoded per URI segment so a value like
 * an encoded cwd round-trips through the router.
 *
 * Returns `null` when the pattern contains a `:param` the match does not
 * supply (e.g. `/automation/run/:sid` cannot fill `/folder/:encodedCwd/...`),
 * so callers degrade to the depth default instead of navigating to a broken
 * URL with a literal `:param` segment.
 */
export function interpolateParentPath(
  parentPath: string,
  params: Record<string, string>,
): string | null {
  const out: string[] = [];
  for (const seg of parentPath.split("/")) {
    if (!seg.startsWith(":")) {
      out.push(seg);
      continue;
    }
    const val = params[seg.slice(1)];
    if (val === undefined) return null;
    out.push(encodeURIComponent(val));
  }
  return out.join("/");
}

/** Minimal claim shape the descriptor emitter reads (subset of `PluginClaim`/
 *  runtime `ClaimEntry` — structurally compatible with both). */
export interface RouteClaimLike {
  slot: string;
  path?: string;
  depth?: 1 | 2;
  parentPath?: string;
}

/**
 * Emit back-action `RouteDescriptor`s from `shell-overlay-route` plugin claims.
 *
 * The back-target classifier merges these plugin descriptors with its static
 * core descriptors, so plugin overlay routes resolve to a defined depth/parent
 * instead of the old depth-0 dead no-op (the classifier had never heard of
 * plugin paths). One descriptor per claim that carries a `path`.
 *
 * Depth defaults to `2` (overlay → cards) when a claim omits `depth`, matching
 * the manifest validator's SHOULD-warn default so a legacy plugin degrades to a
 * working back instead of a dead no-op. A `depth: 2` claim with a `parentPath`
 * gets a `computeParent` that interpolates the parent's `:params` from the
 * current match; when a required `:param` is absent (e.g. a run URL omits the
 * board's cwd) it degrades to `/`.
 *
 * Lives in shared (not the runtime) so the client resolves it through the
 * fully-aliased shared package in a worktree — avoiding a dual-module-instance
 * split against runtime subpath imports.
 *
 * See change: fix-plugin-and-scoped-back-navigation.
 */
export function claimsToRouteDescriptors(claims: RouteClaimLike[]): RouteDescriptor[] {
  const descriptors: RouteDescriptor[] = [];
  for (const claim of claims) {
    if (claim.slot !== "shell-overlay-route") continue;
    if (typeof claim.path !== "string" || claim.path.length === 0) continue;
    const depth: 1 | 2 = claim.depth === 1 ? 1 : 2;
    const parentPath = depth === 2 ? claim.parentPath : undefined;
    descriptors.push({
      pattern: claim.path,
      depth,
      ...(typeof parentPath === "string" && parentPath.length > 0
        ? {
            computeParent: (params: Record<string, string>) =>
              interpolateParentPath(parentPath, params) ?? "/",
          }
        : {}),
    });
  }
  return descriptors;
}
