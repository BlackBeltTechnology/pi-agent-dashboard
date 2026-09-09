/**
 * Single rule for "can this FOLDER host a git worktree?" — consumed by every
 * folder-level surface that asks (sidebar `+ New Worktree`, `Manage
 * worktrees`, the OpenSpec board's per-card `New worktree`, and the board's
 * new-proposal dialog), so the gates cannot drift apart again.
 *
 * Resolution order (design D2/D3):
 *   1. `gitWorktreeEnabled === false` ⇒ `worktrees-disabled` (the actionable
 *      cause wins; an unloaded/`undefined` preference reads as ON so a cold
 *      load never flashes a wrong "disabled in Settings").
 *   2. A non-null `folderGitMap` HEAD for the folder ⇒ git (POSITIVE evidence
 *      only — `null` conflates non-git ∪ unborn repo ∪ read error ∪ stale
 *      cache, so it is treated as UNKNOWN, never as a negative).
 *   3. A session of the folder reporting `isGitRepo === false` ⇒ not git.
 *   4. Otherwise fail open — a wrongly-shown button costs a legible spawn
 *      error; a wrongly-hidden one is the invisible bug this rule fixes.
 *
 * Deliberately independent of `session.gitBranch` and of session liveness:
 * `gitBranch` is only populated for the poll work-set, so gating on it made
 * the board's button vanish when the last live session ended.
 *
 * See change: fix-openspec-board-worktree-button-gating.
 */
import { inferPlatform, pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";

export type WorktreeUnavailableReason = "not-a-git-repo" | "worktrees-disabled";

export interface WorktreeAvailability {
  available: boolean;
  reason?: WorktreeUnavailableReason;
}

export interface WorktreeAvailabilityInput {
  /** Folder path being asked about (raw display path; normalized here). */
  cwd: string;
  /**
   * Candidate sessions. A session with no `cwd` is treated as already scoped
   * to the folder (the `folderIsGitRepo` group-shaped call site); one with a
   * `cwd` must match the folder after `pathKey` normalization.
   */
  sessions: Array<{ cwd?: string; isGitRepo?: boolean }>;
  /** Folder-HEAD map from `git_head_update` (`cwd → branch | null`). */
  folderGitMap?: Map<string, string | null>;
  /** `/api/config` preference; `undefined` = not loaded yet ⇒ enabled. */
  gitWorktreeEnabled?: boolean;
  /** Platform override for tests; inferred from the paths otherwise. */
  platform?: NodeJS.Platform;
}

export function resolveWorktreeAvailability(input: WorktreeAvailabilityInput): WorktreeAvailability {
  if (input.gitWorktreeEnabled === false) return { available: false, reason: "worktrees-disabled" };

  const platform = inferPlatform([input.cwd, ...input.sessions.map((s) => s.cwd)], input.platform);
  const folderKey = pathKey(input.cwd, platform);

  if (input.folderGitMap) {
    for (const [key, branch] of input.folderGitMap) {
      if (branch && pathKey(key, platform) === folderKey) return { available: true };
    }
  }

  const confirmedNonGit = input.sessions.some(
    (s) => s.isGitRepo === false && (s.cwd === undefined || pathKey(s.cwd, platform) === folderKey),
  );
  if (confirmedNonGit) return { available: false, reason: "not-a-git-repo" };

  return { available: true };
}
