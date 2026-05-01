/**
 * Pure helper for the desktop back-arrow priority chain.
 *
 * The desktop session-header back button used to call `window.history.back()`,
 * which was a silent no-op on cold loads / hard refreshes / deep links / post-
 * server-switch state where browser history has only one entry. It also
 * ignored the eight content-area overlay states owned by `App.tsx`, leaving
 * users with three distinct bugs (see proposal `fix-desktop-back-navigation`):
 *
 *   1. Settings hides quietly-set sidebar overlays.
 *   2. Cold-load `/session/:id` back arrow is a no-op.
 *   3. No coordinated back priority across overlays.
 *
 * `selectDesktopBackTarget(state)` mirrors the exact priority chain that
 * mobile's inline `onBack` switch (`App.tsx:1370–1390`) already uses, so
 * desktop and mobile share a single source of truth. The order is:
 *
 *   1. archiveBrowserCwd
 *   2. specsBrowserCwd
 *   3. flowYamlPreview
 *   4. diffViewSessionId
 *   5. piResourceFilePreview
 *   6. readmePreview
 *   7. piResourcesState
 *   8. previewState
 *   9. (fallthrough) → navigate to "/"
 *
 * The helper returns a discriminated union so the calling hook can dispatch
 * to either an overlay setter (`{kind:"clear", target}`) or `navigate("/")`
 * (`{kind:"navigate", to:"/"}`) without a giant if/else.
 *
 * `flowDetailAgent`, `architectDetailOpen`, and `extensionModuleOpen` are
 * NOT in the chain — they are sub-views inside the flow dashboard / portal
 * modals with their own ESC/close affordances.
 *
 * See change: fix-desktop-back-navigation.
 */

/** Identifiers for each of the eight overlay states (priority-ordered). */
export type BackTargetKey =
  | "archive"
  | "specs"
  | "flowYaml"
  | "diff"
  | "piResourceFile"
  | "readme"
  | "piResources"
  | "preview";

/**
 * Boolean flags reflecting which overlays are currently set in App.tsx.
 * `selectedId` is included so the caller can distinguish "session selected
 * but no overlay" (still navigate to "/") from "no session, no overlay"
 * (still navigate to "/" — same fallback).
 */
export interface BackInputState {
  archiveBrowserCwd: boolean;
  specsBrowserCwd: boolean;
  flowYamlPreview: boolean;
  diffViewSessionId: boolean;
  piResourceFilePreview: boolean;
  readmePreview: boolean;
  piResourcesState: boolean;
  previewState: boolean;
  selectedId?: boolean;
}

export type BackTarget =
  | { kind: "clear"; target: BackTargetKey }
  | { kind: "navigate"; to: "/" };

/** Priority chain — must match mobile's inline `onBack` switch exactly. */
const PRIORITY_CHAIN: ReadonlyArray<{ key: keyof BackInputState; target: BackTargetKey }> = [
  { key: "archiveBrowserCwd", target: "archive" },
  { key: "specsBrowserCwd", target: "specs" },
  { key: "flowYamlPreview", target: "flowYaml" },
  { key: "diffViewSessionId", target: "diff" },
  { key: "piResourceFilePreview", target: "piResourceFile" },
  { key: "readmePreview", target: "readme" },
  { key: "piResourcesState", target: "piResources" },
  { key: "previewState", target: "preview" },
];

/**
 * Pick the next back-target for a given overlay-state snapshot.
 *
 * - If any overlay flag is true, return `{kind:"clear", target}` for the
 *   highest-priority one. Earlier entries in `PRIORITY_CHAIN` win.
 * - Otherwise, return `{kind:"navigate", to:"/"}`. We always navigate to
 *   `/` rather than `navigate(-1)` because cold loads have empty history
 *   and `navigate(-1)` would be a silent no-op.
 *
 * Pure: depends only on `state`. No React, no DOM, no `window`.
 */
export function selectDesktopBackTarget(state: BackInputState): BackTarget {
  for (const { key, target } of PRIORITY_CHAIN) {
    if (state[key]) return { kind: "clear", target };
  }
  return { kind: "navigate", to: "/" };
}
