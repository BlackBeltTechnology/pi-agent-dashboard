/**
 * Red `cwd gone` pill on the WORKSPACE subcard. Renders only when
 * `session.cwdMissing === true`. Companion to `<WorktreePill>`.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function CwdGonePill({ session }: { session: DashboardSession }) {
  if (!session.cwdMissing) return null;
  return (
    <span
      data-testid="cwd-gone-pill"
      title="session's directory no longer exists"
      className="inline-flex items-center px-1.5 py-px rounded-full text-[9px] uppercase tracking-wider border border-red-500/60 text-red-300 bg-red-500/10"
    >
      cwd gone
    </span>
  );
}
