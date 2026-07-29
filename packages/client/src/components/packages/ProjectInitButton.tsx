/**
 * "Set up project" button for a truly-unconfigured directory row.
 *
 * Presentational + monomorphic: renders ONLY for state ①
 * (`{ hasHook:false, configured:false }`) and routes its click to spawning an
 * interactive project-init session that scaffolds a new pi project
 * (`AGENTS.md` + `.pi/settings.json`). It does NOT execute repo code, so it
 * carries a distinct indigo identity separate from the amber, hook-running
 * `WorktreeInitButton`.
 *
 * Gating is strict (`=== false`): a configured-but-hookless project (state ③,
 * `configured:true`) and any degraded/absent-`configured` probe render nothing.
 *
 * See change: distinguish-initialize-actions.
 */

import { mdiFolderPlusOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import type { WorktreeInitStatus } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  /** Shared init-status probe result from the row (single fetch). */
  status: WorktreeInitStatus | null;
  /**
   * Called when the user clicks. Routes to spawning an interactive project-init
   * session in `cwd`. When omitted, nothing renders.
   */
  onInitializeProject?: (cwd: string) => void;
  /** Menu presentation keeps the action visually consistent with folder tools. */
  variant?: "inline" | "menu";
}

export function ProjectInitButton({ cwd, status, onInitializeProject, variant = "inline" }: Props) {
  // Strict `=== false`: only an explicitly-unconfigured directory offers the
  // scaffold. Absent `configured` (degraded probe) or `configured:true`
  // (already a pi project) render nothing.
  const show = !!status && status.hasHook === false && status.configured === false && !!onInitializeProject;
  if (!show) return null;

  return (
    <button
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      onClick={(e) => { e.stopPropagation(); onInitializeProject?.(cwd); }}
      data-testid="project-init-btn"
      className={variant === "menu"
        ? "focus-ring flex w-full items-center gap-[10px] rounded-[6px] p-2 text-left hover:bg-[var(--bg-hover)]"
        : "text-[10px] px-1.5 py-0.5 rounded border text-indigo-400 border-indigo-500/40 bg-indigo-500/5 hover:text-indigo-300 hover:border-indigo-500/70"}
      title={i18nT("folders.setUpThisDirectoryAsAPiProject", undefined, "Set up this directory as a pi project (scaffold AGENTS.md + .pi/settings.json)")}
    >
      {variant === "menu" ? <>
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-indigo-500">
          <Icon path={mdiFolderPlusOutline} size={0.52} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">{i18nT("common.setUpProject", undefined, "Set up project")}</span>
          <span className="font-mono text-[9px] font-normal text-[var(--text-muted)]">{i18nT("folders.projectScaffold", undefined, "Create project configuration")}</span>
        </span>
      </> : <span className="inline-flex items-center gap-0.5">
        <Icon path={mdiFolderPlusOutline} size={0.5} />
        {i18nT("common.setUpProject", undefined, "Set up project")}
      </span>}
    </button>
  );
}
