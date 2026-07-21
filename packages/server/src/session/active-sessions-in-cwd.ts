/**
 * Pure helper: given a target path + a session list, return the IDs of
 * sessions whose `cwd` is `path` or a descendant directory.
 *
 * Used by the worktree/remove pre-flight to gate destructive removal
 * behind an active-session confirmation in the client.
 *
 * Case-folding follows `samePath` semantics (case-insensitive on
 * win32/darwin, sensitive on linux) via shared platform helpers.
 *
 * Sessions with `status === "ended"` are excluded — ended sessions
 * cannot block a worktree removal (their bridge is gone).
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * True when `child` is `parent` itself or any descendant. Operates on
 * normalised paths so separator drift between `\` and `/` on Windows
 * is tolerated. Case-folding matches `samePath` semantics.
 */
export function isPathInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!parent || !child) return false;
  const np = normalizePath(parent, platform);
  const nc = normalizePath(child, platform);
  if (!np || !nc) return false;
  // Choose the platform-correct separator for the boundary check.
  const sep = platform === "win32" ? "\\" : "/";
  // Strip a trailing separator from `parent` so "/foo/" + "/foo" still match.
  const parentTrimmed = np.endsWith(sep) && np.length > 1 ? np.slice(0, -1) : np;
  const caseFold = platform !== "linux";
  const a = caseFold ? parentTrimmed.toLowerCase() : parentTrimmed;
  const b = caseFold ? nc.toLowerCase() : nc;
  if (a === b) return true;
  return b.startsWith(a + sep);
}

/**
 * Active sessions whose `cwd` is at `targetPath` or a descendant.
 * Pure — no I/O. Ended sessions are excluded.
 */
export function activeSessionsUnder(
  targetPath: string,
  sessions: ReadonlyArray<Pick<DashboardSession, "id" | "cwd" | "status">>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!targetPath) return [];
  const out: string[] = [];
  for (const s of sessions) {
    if (!s || !s.cwd) continue;
    if (s.status === "ended") continue;
    if (isPathInside(targetPath, s.cwd, platform)) out.push(s.id);
  }
  return out;
}

/**
 * All sessions (active OR ended) whose `cwd` is at `targetPath` or a
 * descendant. Used by the lifecycle endpoints to stamp `cwdMissing` on
 * EVERY session under a removed worktree.
 */
export function sessionsUnder(
  targetPath: string,
  sessions: ReadonlyArray<Pick<DashboardSession, "id" | "cwd">>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!targetPath) return [];
  const out: string[] = [];
  for (const s of sessions) {
    if (!s || !s.cwd) continue;
    if (isPathInside(targetPath, s.cwd, platform)) out.push(s.id);
  }
  return out;
}
