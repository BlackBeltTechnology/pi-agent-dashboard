/**
 * Detached spawn tray for folder groups in the sidebar.
 *
 * Renders two spawn buttons in a Create tray positioned OUTSIDE the directory
 * card's bordered surface (a sibling below the card — see
 * `SessionList.renderGroup`):
 *   - `+ New Session` (`--tint-green-*`) — always rendered.
 *   - `+ New Worktree` (`--tint-orange-*`) — rendered only when `showWorktree` holds.
 *
 * A responsive grid: two columns when the worktree button shows, collapsing to
 * a single column at the mobile breakpoint. Props + `data-testid`s unchanged.
 *
 * See change: elevate-folder-spawn-buttons; redesign-directory-card (D3);
 * align-ui-with-theme-tokens (identity tints, D2).
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
            : "text-[var(--tint-green-fg)] border-[var(--tint-green-border)] bg-[var(--tint-green-bg)] hover:bg-[color-mix(in_srgb,var(--tint-green-bg)_70%,var(--tint-green-border))]"
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
          className="focus-ring w-full text-[13px] font-bold px-3 py-2.5 min-h-[44px] sm:min-h-0 rounded-xl border flex items-center justify-center gap-1.5 text-[var(--tint-orange-fg)] border-[var(--tint-orange-border)] bg-[var(--tint-orange-bg)] hover:bg-[color-mix(in_srgb,var(--tint-orange-bg)_70%,var(--tint-orange-border))]"
          title={i18nT("git.newPiSessionInAGit", undefined, "New pi session in a git worktree")}
        >
          <Icon path={mdiSourceBranchPlus} size={0.6} /> {i18nT("worktree.newWorktree2", undefined, "New Worktree")}
        </button>
      )}
    </div>
  );
}
