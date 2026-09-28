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
import { isPathInside } from "@blackbelt-technology/pi-dashboard-shared/path-containment.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Boundary-correct containment predicate. The implementation now lives in
 * `packages/shared/src/path-containment.ts` so the shared OpenSpec activity
 * detector can reuse it; re-exported here so existing server callers keep
 * their import path. See change: scope-openspec-auto-attach-to-session-cwd.
 */
export { isPathInside };

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

/**
 * Active sessions whose REALPATH-normalized `cwd` is at the realpath of
 * `targetPath` or inside it. Symlinked worktree roots and symlinked session
 * cwds both match. Drives the post-Push / post-Open-PR `git_info_refresh`
 * fan-out. `realpath` is injected for tests (prod: `safeRealpathSync`).
 * See change: redesign-composer-session-strip (D5).
 */
export function activeSessionsUnderResolved(
  targetPath: string,
  sessions: ReadonlyArray<Pick<DashboardSession, "id" | "cwd" | "status">>,
  realpath: (p: string) => string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!targetPath) return [];
  const root = realpath(targetPath);
  return activeSessionsUnder(
    root,
    sessions.map((s) => ({ ...s, cwd: s.cwd ? realpath(s.cwd) : s.cwd })),
    platform,
  );
}
