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
import type { ReactNode } from "react";
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
  /** Optional compact overflow action shown beside the primary creation controls. */
  overflow?: ReactNode;
}

export function FolderSpawnButtons({
  spawningDisabled,
  showWorktree,
  onSpawnSession,
  onSpawnWorktree,
  overflow,
}: Props) {
  return (
    <div className={`grid items-center gap-2 ${overflow ? (showWorktree ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_44px] sm:grid-cols-[minmax(0,1fr)_auto]") : (showWorktree ? "grid-cols-2" : "grid-cols-1")}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        data-testid="folder-spawn-session-btn"
        className={`focus-ring flex w-full min-h-[44px] items-center justify-center gap-[5px] rounded-[6px] border px-[10px] py-2 text-[11px] font-semibold leading-none sm:min-h-0 ${
          spawningDisabled
            ? "border-[var(--border-secondary)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
            : "border-[var(--border-primary)] bg-[#E7F6F0] text-[#047857] hover:bg-[#D8F0E5]"
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
          className="focus-ring flex w-full min-h-[44px] items-center justify-center gap-[5px] rounded-[6px] border border-[var(--border-primary)] bg-[#FDF0E4] px-[10px] py-2 text-[11px] font-semibold leading-none text-[#B45309] hover:bg-[#F9E4D0] sm:min-h-0"
          title={i18nT("git.newPiSessionInAGit", undefined, "New pi session in a git worktree")}
        >
          <Icon path={mdiSourceBranchPlus} size={0.6} /> {i18nT("worktree.newWorktree2", undefined, "New Worktree")}
        </button>
      )}
      {overflow}
    </div>
  );
}
