/**
 * Elevated spawn-button stack for folder groups in the sidebar.
 *
 * Renders two full-width stacked line buttons in the always-visible folder
 * header (below the trimmed FolderActionBar, above the plugin/OpenSpec
 * sections):
 *   - `+ New Session` (green) — always rendered.
 *   - `+ New Worktree` (orange) — rendered only when `showWorktree` holds.
 *
 * See change: elevate-folder-spawn-buttons.
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
    <div className="flex flex-col gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        data-testid="folder-spawn-session-btn"
        className={`focus-ring w-full text-xs px-2 py-1 min-h-[44px] sm:min-h-0 rounded border flex items-center justify-center gap-0.5 ${
          spawningDisabled
            ? "border-[var(--border-secondary)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
            : "text-green-400 border-green-500/40 bg-green-500/5 hover:text-green-300 hover:border-green-500/70"
        }`}
        title={i18nT("session.newPiSession", undefined, "New pi session")}
      >
        <Icon path={mdiPlus} size={0.6} /> {i18nT("session.newSession2", undefined, "New Session")}
      </button>

      {showWorktree && (
        <button
          onClick={(e) => { e.stopPropagation(); onSpawnWorktree!(); }}
          data-testid="folder-spawn-worktree-btn"
          className="focus-ring w-full text-xs px-2 py-1 min-h-[44px] sm:min-h-0 rounded border flex items-center justify-center gap-0.5 text-orange-400 border-orange-500/40 bg-orange-500/5 hover:text-orange-300 hover:border-orange-500/70"
          title={i18nT("git.newPiSessionInAGit", undefined, "New pi session in a git worktree")}
        >
          <Icon path={mdiSourceBranchPlus} size={0.6} /> {i18nT("worktree.newWorktree2", undefined, "New Worktree")}
        </button>
      )}
    </div>
  );
}
