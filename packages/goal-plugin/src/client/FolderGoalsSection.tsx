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
import { SlotPill, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiPlus, mdiRefresh, mdiTarget } from "@mdi/js";
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
      <SlotPill
        glyph={mdiTarget}
        accent="indigo"
        label={t("goals", undefined, "Goals")}
        activateTestId="folder-goals-open-board"
        activateTitle={t("openGoalsBoard", undefined, "Open goals board")}
        onActivate={() => navigate(goalsBoardUrl(cwd))}
        actions={
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); refetch(); }}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1"
              title={t("refresh", undefined, "Refresh")}
              data-testid="folder-goals-refresh"
            >
              <Icon path={mdiRefresh} size={0.5} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCreating((v) => !v); }}
              className="text-[10px] px-1.5 py-0.5 rounded border text-indigo-400 border-indigo-500/40 bg-indigo-500/5 hover:text-indigo-300 hover:border-indigo-500/70"
              data-testid="folder-goal-new-btn"
            >
              <Icon path={mdiPlus} size={0.4} className="inline mr-0.5" />{t("goalButton", undefined, "Goal")}
            </button>
          </>
        }
      >
        <span data-testid="folder-goals-count">{goals.length}</span>
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{t("goalsUnit", undefined, "active")}</span>
      </SlotPill>
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
