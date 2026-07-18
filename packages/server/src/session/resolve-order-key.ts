/**
 * Resolve the `sessionOrder` map key for a session, server-side.
 *
 * Wraps the shared `resolveSessionGroupPath` (the SAME resolver the client
 * grouping uses) with the server's `process.platform` and the user's pinned
 * directories. Every order-map mutation (`insert` / `moveToFront` / `remove`)
 * MUST route through this so worktree sessions write to the parent-repo
 * key the client actually reads — fixing the prior silent no-op where the
 * server keyed by raw `session.cwd`.
 *
 * See change: simplify-session-card-ordering.
 */
import {
  pathKey,
  resolveSessionGroupPath,
} from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type OrderKeyResolvable = Pick<
  DashboardSession,
  "cwd" | "gitWorktree"
>;

/**
 * Compute the resolved group path used as the order-map key.
 * `pinnedDirectories` are the user's pinned folders (display paths);
 * an explicit pin on the session's own `cwd` wins over worktree collapse.
 */
export function resolveOrderKey(
  session: OrderKeyResolvable,
  pinnedDirectories: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): string {
  const pinnedKeys = new Set(pinnedDirectories.map((d) => pathKey(d, platform)));
  return resolveSessionGroupPath(session, pinnedKeys, platform);
}
