/**
 * Red `cwd gone` pill on the WORKSPACE subcard. Renders only when
 * `session.cwdMissing === true`. Companion to `<WorktreePill>`.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../lib/i18n";

export function CwdGonePill({ session }: { session: DashboardSession }) {
  if (!session.cwdMissing) return null;
  return (
    <span
      data-testid="cwd-gone-pill"
      title={i18nT("auto.session_s_directory_no_longer_exists", undefined, "session's directory no longer exists")}
      className="inline-flex items-center px-1.5 py-px rounded-full text-[9px] uppercase tracking-wider border border-red-500/60 text-red-300 bg-red-500/10"
    >
      {i18nT("auto.cwd_gone", undefined, "cwd gone")}
    </span>
  );
}
