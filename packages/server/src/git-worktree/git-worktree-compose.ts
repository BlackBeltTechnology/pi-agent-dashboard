/**
 * Pure helper for composing the live `gitWorktree` payload (from a bridge
 * `git_info_update` message) with the server-cached `gitWorktreeBase`
 * (loaded from `.meta.json` by `session-scanner` or set at spawn time by
 * the worktree dialog flow).
 *
 * Three cases the caller cares about:
 *   1. Bridge sent `gitWorktree: null` → clear state (return `null`).
 *   2. Bridge sent a `GitWorktreeInfo` object → merge in cached `base`
 *      iff `base` was not already supplied AND a cached value exists.
 *   3. Bridge omitted `gitWorktree` (older bridge or no change) → return
 *      `undefined`; caller leaves any existing in-memory value alone.
 *
 * Kept as a pure function (no imports of session-manager / fs / wire
 * types) so it's straightforward to unit-test without spinning up the
 * full server.
 *
 * See change: add-worktree-spawn-dialog.
 */
import type { GitWorktreeInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type WireGitWorktree = GitWorktreeInfo | null | undefined;

/**
 * Compose the broadcast-shape `gitWorktree`.
 *
 * @param wire     The `gitWorktree` field from the bridge message
 *                 (`undefined` | `null` | `GitWorktreeInfo`).
 * @param cachedBase  Server-cached base ref from `.meta.json`, or undefined.
 * @returns
 *   - `null`       if the bridge explicitly cleared worktree state,
 *   - the merged `GitWorktreeInfo` (with `base` filled in from cache when
 *     applicable) if the bridge sent live worktree state,
 *   - `undefined`  if the bridge omitted the field (no change).
 */
export function composeWorktreePayload(
  wire: WireGitWorktree,
  cachedBase: string | undefined,
): GitWorktreeInfo | null | undefined {
  if (wire === undefined) return undefined;
  if (wire === null) return null;
  // Don't clobber an explicit base supplied by the bridge (none today,
  // but defensive).
  if (wire.base !== undefined) return wire;
  if (cachedBase === undefined) return wire;
  return { ...wire, base: cachedBase };
}
