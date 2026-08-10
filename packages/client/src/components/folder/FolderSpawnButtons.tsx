/**
 * Detached spawn tray for folder groups in the sidebar.
 *
 * Renders two spawn buttons in a Create tray positioned OUTSIDE the directory
 * card's bordered surface (a sibling below the card — see
 * `SessionList.renderGroup`):
 *   - `+ New Session` (green) — always rendered.
 *   - `+ New Worktree` (orange) — rendered only when `showWorktree` holds.
 *
 * A responsive grid: two columns when the worktree button shows, collapsing to
 * a single column at the mobile breakpoint. Props + `data-testid`s unchanged.
 *
 * See change: elevate-folder-spawn-buttons; redesign-directory-card (D3).
 */

import { mdiPlus, mdiSourceBranchPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  /** Disables `+ New Session` while a session is being spawned in this folder. */
  spawningDisabled?: boolean;
  /**
   * Whether to render `+ New Worktree`. Caller computes
   * `isGitRepo && gitWorktreeEnabled && !!onSpawnWorktree`.
   */
  showWorktree: boolean;
  onSpawnSession: () => void;
  onSpawnWorktree?: () => void;
}

export function FolderSpawnButtons({
  spawningDisabled,
  showWorktree,
  onSpawnSession,
  onSpawnWorktree,
}: Props) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${showWorktree ? "sm:grid-cols-2" : ""}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        data-testid="folder-spawn-session-btn"
        className={`focus-ring w-full text-[13px] font-bold px-3 py-2.5 min-h-[44px] sm:min-h-0 rounded-xl border flex items-center justify-center gap-1.5 ${
          spawningDisabled
            ? "border-[var(--border-secondary)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
            : "text-green-400 border-green-500/45 bg-green-500/5 hover:text-green-300 hover:bg-green-500/10"
        }`}
        title={i18nT("session.newPiSession", undefined, "New pi session")}
      >
        <Icon path={mdiPlus} size={0.6} /> {i18nT("session.newSession2", undefined, "New Session")}
      </button>

      {showWorktree && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSpawnWorktree!(); }}
          data-testid="folder-spawn-worktree-btn"
          className="focus-ring w-full text-[13px] font-bold px-3 py-2.5 min-h-[44px] sm:min-h-0 rounded-xl border flex items-center justify-center gap-1.5 text-orange-400 border-orange-500/45 bg-orange-500/5 hover:text-orange-300 hover:bg-orange-500/10"
          title={i18nT("git.newPiSessionInAGit", undefined, "New pi session in a git worktree")}
        >
          <Icon path={mdiSourceBranchPlus} size={0.6} /> {i18nT("worktree.newWorktree2", undefined, "New Worktree")}
        </button>
      )}
    </div>
  );
}
