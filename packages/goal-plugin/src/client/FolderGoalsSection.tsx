/**
 * FolderGoalsSection — `sidebar-folder-section` slot claim.
 *
 * Sibling of the OpenSpec / Automations folder nav slots: shows
 * `Goals (N) →` (opens the goals board for this folder) plus a `+ Goal`
 * create affordance that opens the shared `CreateGoalDialog` modal (parity
 * with the automation plugin's `CreateAutomationDialog`).
 *
 * Plugin-local: navigates the shell in-app via wouter's `useLocation`; no
 * core/shell edit. See change: add-goals-folder-page (tasks 3.1, 3.2);
 * redesign-goal-create-dialog (task 2.1).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiArrowRight, mdiPlus, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import { CreateGoalDialog } from "./CreateGoalDialog.js";
import { goalsBoardUrl } from "./goals-api.js";
import { useGoals } from "./useGoals.js";

export function FolderGoalsSection({ folder }: { folder: FolderDescriptor }): React.ReactElement | null {
  const t = useT();
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { goals, refetch } = useGoals(cwd);
  const [creating, setCreating] = useState(false);

  if (!cwd) return null;

  return (
    <div data-testid="folder-goals-section" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mt-1">
        <button
          data-testid="folder-goals-open-board"
          onClick={(e) => { e.stopPropagation(); navigate(goalsBoardUrl(cwd)); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase hover:text-indigo-400"
          title={t("openGoalsBoard", undefined, "Open goals board")}
        >
          <span>{t("goalsCount", { count: goals.length }, `Goals (${goals.length})`)}</span>
          <Icon path={mdiArrowRight} size={0.45} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); refetch(); }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={t("refresh", undefined, "Refresh")}
          data-testid="folder-goals-refresh"
        >
          <Icon path={mdiRefresh} size={0.5} />
        </button>
        <span className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); setCreating((v) => !v); }}
          className="text-[10px] px-1.5 py-0.5 rounded border text-indigo-400 border-indigo-500/40 bg-indigo-500/5 hover:text-indigo-300 hover:border-indigo-500/70"
          data-testid="folder-goal-new-btn"
        >
          <Icon path={mdiPlus} size={0.4} className="inline mr-0.5" />{t("goalButton", undefined, "Goal")}
        </button>
      </div>
      {creating && (
        <CreateGoalDialog
          cwd={cwd}
          onClose={() => setCreating(false)}
          onCreated={() => { refetch(); navigate(goalsBoardUrl(cwd)); }}
        />
      )}
    </div>
  );
}
