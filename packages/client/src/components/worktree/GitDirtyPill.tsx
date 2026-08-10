/**
 * Shared dirty/drift indicator rendered on BOTH git surfaces (`GitInfo` on a
 * solo/worktree card, `GroupGitInfo` on a folder header). Extracted so both
 * hosts render identically.
 *
 * `● N` amber pill = N uncommitted files (staged + unstaged + untracked).
 * `↑A` / `↓B` chips = commits ahead / behind upstream (only when non-zero).
 * The whole pill is a button → opens the commit dialog. Hidden when the tree
 * is clean AND in sync, and when `status` is absent (legacy/inconclusive).
 *
 * Self-contained + plugin-ready. See change:
 * add-session-uncommitted-indicator-and-commit.
 */
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  status: GitStatus | undefined;
  /** Opens the commit dialog for the pill's cwd. */
  onClick: () => void;
  className?: string;
}

export function GitDirtyPill({ status, onClick, className }: Props) {
  if (!status) return null;
  const { dirtyCount, ahead, behind } = status;
  if (dirtyCount === 0 && ahead === 0 && behind === 0) return null;

  const title = i18nT(
    "common.uncommittedDrift",
    undefined,
    `${dirtyCount} uncommitted${ahead ? ` · ↑${ahead}` : ""}${behind ? ` · ↓${behind}` : ""}`,
  );

  return (
    <button
      type="button"
      data-testid="git-dirty-pill"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] leading-none border transition-colors hover:brightness-110 ${className ?? ""}`}
      style={{
        borderColor: "var(--status-warning, #d97706)",
        color: "var(--status-warning, #d97706)",
      }}
    >
      {dirtyCount > 0 && (
        <span data-testid="git-dirty-count" className="inline-flex items-center gap-0.5">
          <span aria-hidden>●</span>
          <span>{dirtyCount}</span>
        </span>
      )}
      {ahead > 0 && (
        <span data-testid="git-ahead" className="text-[var(--text-secondary)]">↑{ahead}</span>
      )}
      {behind > 0 && (
        <span data-testid="git-behind" className="text-[var(--text-secondary)]">↓{behind}</span>
      )}
    </button>
  );
}
