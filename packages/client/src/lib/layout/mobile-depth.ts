/**
 * Inputs for computing mobile navigation depth.
 *
 * After overlay-url-routing: shell overlays are URL-driven, so depth is
 * derived from `useRoute` match flags instead of `useState` overlay flags.
 * Plugin-owned overlays (flows-plugin content-view claims) are NOT reflected
 * here — they live in a predicate-driven path scoped to session detail
 * (depth 1) and don't push depth to 2.
 *
 * See change: overlay-url-routing.
 */
export interface MobileDepthInput {
  /** /session/:id (or any /session/:id/* subroute except plugin overlays). */
  hasSessionRoute: boolean;
  /** /folder/:cwd/terminals or /folder/:cwd/editor (no overlay). */
  hasFolderRoute: boolean;
  /** /settings */
  hasSettingsRoute: boolean;
  /** /folder/:cwd/settings — Directory Settings (depth-1 detail, mirrors
   *  global settings). See change: directory-settings-page-and-scoped-md-editing. */
  hasFolderSettingsRoute: boolean;
  /** /tunnel-setup */
  hasTunnelRoute: boolean;
  /** Any of the 6 shell-owned overlay routes (openspec preview/archive/specs, readme, pi-resources, session diff). */
  hasOverlayRoute: boolean;
  /** /pi-resource cross-folder route (counted as an overlay for depth). */
  hasPiResourceRoute: boolean;
}

/**
 * Compute MobileShell depth: 0 = list, 1 = detail, 2 = preview.
 *
 * Order matters:
 *  - depth 2 if any preview-style overlay route matches
 *  - depth 1 if any detail route matches (session / folder / settings / tunnel)
 *  - depth 0 otherwise
 */
export function getMobileDepth(input: MobileDepthInput): number {
  if (input.hasOverlayRoute || input.hasPiResourceRoute) return 2;
  if (
    input.hasSessionRoute ||
    input.hasFolderRoute ||
    input.hasSettingsRoute ||
    input.hasFolderSettingsRoute ||
    input.hasTunnelRoute
  ) return 1;
  return 0;
}
