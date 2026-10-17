/**
 * Red `folder missing` pill in the desktop session card's TITLE row (after the
 * name, before the time). Renders only when `session.cwdMissing === true`,
 * independent of git / worktree / folder-group state.
 *
 * See changes: add-worktree-lifecycle-actions, compact-session-card-header.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export function CwdGonePill({ session }: { session: DashboardSession }) {
  if (!session.cwdMissing) return null;
  return (
    <span
      data-testid="cwd-gone-pill"
      title={i18nT("folders.sessionSDirectoryNoLongerExists", undefined, "This session's folder no longer exists")}
      className="inline-flex items-center flex-shrink-0 px-1.5 py-0 rounded-full text-[11px] border border-[var(--tint-red-border)] text-[var(--tint-red-fg)] bg-[var(--tint-red-bg)]"
    >
      {i18nT("common.cwdGone", undefined, "folder missing")}
    </span>
  );
}
