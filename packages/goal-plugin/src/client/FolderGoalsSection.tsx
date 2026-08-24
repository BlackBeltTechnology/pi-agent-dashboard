/**
 * FolderGoalsSection — `sidebar-folder-section` slot claim.
 *
 * Sibling of the OpenSpec / Automations folder nav slots: shows
 * `Goals (N) →` (opens the goals board for this folder). The pill is
 * STATE-ONLY — goal creation is a `CREATE`-group item and the refetch is a
 * refresher folded into the menu's single `MAINTENANCE` refresh.
 *
 * Plugin-local: navigates the shell in-app via wouter's `useLocation`; no
 * core/shell edit. See change: add-goals-folder-page (tasks 3.1, 3.2);
 * redesign-goal-create-dialog (task 2.1); move-slot-actions-to-menu.
 */
import {
  SlotPill,
  useFolderMenuItem,
  useFolderMenuRefresher,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiPlus, mdiTarget } from "@mdi/js";
import type React from "react";
import { useMemo, useState } from "react";
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

  const newGoalLabel = t("goalButton", undefined, "New goal");
  useFolderMenuItem(
    cwd,
    useMemo(
      () => ({
        id: "new-goal",
        group: "create" as const,
        label: newGoalLabel,
        icon: mdiPlus,
        onSelect: () => setCreating(true),
      }),
      [newGoalLabel],
    ),
  );
  useFolderMenuRefresher(cwd, refetch);

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
