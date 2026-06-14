/**
 * Worktree-state derivation for OpenSpec board proposal cards.
 *
 * A session whose cwd is a git worktree (`session.gitWorktree`) carries its
 * own `tasks.md` state, which can differ from the proposal's main-checkout
 * state. The board shows the worktree's own `done/total` plus a delta vs the
 * proposal (main). The worktree's own progress comes from the per-cwd
 * OpenSpec poll of the worktree dir (its `OpenSpecData`), keyed by the
 * session's cwd in `openspecMap`.
 *
 * See change: redesign-openspec-board (openspec-card-section worktree spec).
 */
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface WorktreeProgress {
  /** Worktree directory basename (e.g. `os/redesign-board`). */
  name: string;
  /** Base ref the worktree forked from, when known. */
  base?: string;
  /** Worktree's own completed task count for this change, or null if unknown. */
  done: number | null;
  /** Worktree's own total task count for this change, or null if unknown. */
  total: number | null;
  /** Worktree-done minus main-done; positive = ahead, negative = behind. */
  delta: number | null;
}

/**
 * Derive worktree progress + delta for a session row, or `null` when the
 * session is not a worktree (so the row renders no marker).
 *
 * @param session       The session row's session.
 * @param changeName    The proposal/change name the card represents.
 * @param mainDone      The proposal's main-checkout completed task count.
 * @param openspecMap   Per-cwd OpenSpec data (worktree dir keyed by session.cwd).
 */
export function deriveWorktreeProgress(
  session: DashboardSession,
  changeName: string,
  mainDone: number,
  openspecMap: Map<string, OpenSpecData> | undefined,
): WorktreeProgress | null {
  const wt = session.gitWorktree;
  if (!wt) return null;

  const wtData = openspecMap?.get(session.cwd);
  const wtChange = wtData?.changes.find((c) => c.name === changeName);
  const done = wtChange ? wtChange.completedTasks : null;
  const total = wtChange ? wtChange.totalTasks : null;
  const delta = done != null ? done - mainDone : null;

  return {
    name: wt.name,
    ...(wt.base !== undefined ? { base: wt.base } : {}),
    done,
    total,
    delta,
  };
}
