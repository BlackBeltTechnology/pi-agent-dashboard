import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Worktree identity from existing session fields, shown in the composer dock's
 * Changes lane header (moved out of `ComposerSessionActions`).
 *
 * Every marker carries a text alternative; "no local changes" never claims
 * "in sync" (ahead/behind are 0 without an upstream), and an absent
 * `gitStatus` renders neither drift nor a no-changes marker. The base shows
 * only when `gitWorktree.base` is known. The tooltip names the worktree and
 * its main checkout.
 *
 * See changes: redesign-composer-session-strip (D4), add-composer-dock (task 4.1).
 */
export function GitIdentity({ session }: { session: DashboardSession }) {
  const wt = session.gitWorktree;
  const st = session.gitStatus;
  const title = wt ? `${wt.name} — ${wt.mainPath}` : undefined;
  const clean = st && st.dirtyCount === 0 && st.ahead === 0 && st.behind === 0;
  const noChanges = i18nT("git.noLocalChanges", undefined, "no local changes");
  return (
    <span
      data-testid="composer-git-identity"
      title={title}
      className="inline-flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]"
    >
      {session.gitBranch && (
        <span data-testid="composer-git-branch" className="truncate max-w-[24ch]">
          <span aria-hidden="true">⎇ </span>
          {session.gitBranch}
        </span>
      )}
      {wt?.base && (
        <span data-testid="composer-git-base" className="text-[var(--text-secondary)]">
          <span aria-hidden="true">← </span>
          <span className="sr-only">{i18nT("git.fromBase", undefined, "from")} </span>
          {wt.base}
        </span>
      )}
      {st && st.dirtyCount > 0 && (
        <span
          data-testid="composer-git-dirty"
          className="text-[var(--accent-orange-text)]"
          title={i18nT("git.changedFiles", { count: st.dirtyCount }, "{count} changed files")}
        >
          <span aria-hidden="true">● {st.dirtyCount}</span>
          <span className="sr-only">{i18nT("git.changedFiles", { count: st.dirtyCount }, "{count} changed files")}</span>
        </span>
      )}
      {st && st.ahead > 0 && (
        <span data-testid="composer-git-ahead" title={i18nT("git.commitsAhead", { count: st.ahead }, "{count} commits ahead")}>
          <span aria-hidden="true">↑{st.ahead}</span>
          <span className="sr-only">{i18nT("git.commitsAhead", { count: st.ahead }, "{count} commits ahead")}</span>
        </span>
      )}
      {st && st.behind > 0 && (
        <span data-testid="composer-git-behind" title={i18nT("git.commitsBehind", { count: st.behind }, "{count} commits behind")}>
          <span aria-hidden="true">↓{st.behind}</span>
          <span className="sr-only">{i18nT("git.commitsBehind", { count: st.behind }, "{count} commits behind")}</span>
        </span>
      )}
      {clean && (
        <span data-testid="composer-git-clean" className="text-[var(--text-secondary)]" title={noChanges}>
          <span aria-hidden="true">✓</span>
          <span className="sr-only">{noChanges}</span>
        </span>
      )}
    </span>
  );
}
