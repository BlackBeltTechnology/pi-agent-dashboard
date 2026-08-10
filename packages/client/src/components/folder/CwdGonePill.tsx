/**
 * Red `cwd gone` pill on the WORKSPACE subcard. Renders only when
 * `session.cwdMissing === true`. Companion to `<WorktreePill>`.
 *
 * See change: add-worktree-lifecycle-actions.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export function CwdGonePill({ session }: { session: DashboardSession }) {
  if (!session.cwdMissing) return null;
  return (
    <span
      data-testid="cwd-gone-pill"
      title={i18nT("folders.sessionSDirectoryNoLongerExists", undefined, "session's directory no longer exists")}
      className="inline-flex items-center px-1.5 py-px rounded-full text-[9px] uppercase tracking-wider border border-red-500/60 text-red-300 bg-red-500/10"
    >
      {i18nT("common.cwdGone", undefined, "cwd gone")}
    </span>
  );
}
