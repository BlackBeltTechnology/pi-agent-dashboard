/**
 * FolderGoalsSection — `sidebar-folder-section` slot claim.
 *
 * Sibling of the OpenSpec / Automations folder nav slots: shows
 * `Goals (N) →` (opens the goals board for this folder) plus a `+ Goal`
 * create affordance (inline objective capture → POST → navigate to board).
 *
 * Plugin-local: navigates the shell in-app via wouter's `useLocation`; no
 * core/shell edit. See change: add-goals-folder-page (tasks 3.1, 3.2).
 */
import React, { useState } from "react";
import { useLocation } from "wouter";
import { Icon } from "@mdi/react";
import { mdiArrowRight, mdiPlus, mdiRefresh } from "@mdi/js";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { useGoals } from "./useGoals.js";
import { createGoal, goalsBoardUrl } from "./goals-api.js";
import { GoalForm, type GoalFormPayload } from "./GoalForm.js";

export function FolderGoalsSection({ folder }: { folder: FolderDescriptor }): React.ReactElement | null {
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { goals, refetch } = useGoals(cwd);
  const [creating, setCreating] = useState(false);

  if (!cwd) return null;

  const submit = async (payload: GoalFormPayload): Promise<void> => {
    await createGoal(cwd, payload);
    setCreating(false);
    refetch();
    navigate(goalsBoardUrl(cwd));
  };

  return (
    <div data-testid="folder-goals-section" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mt-1">
        <button
          data-testid="folder-goals-open-board"
          onClick={(e) => { e.stopPropagation(); navigate(goalsBoardUrl(cwd)); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase hover:text-indigo-400"
          title="Open goals board"
        >
          <span>Goals ({goals.length})</span>
          <Icon path={mdiArrowRight} size={0.45} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); refetch(); }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title="Refresh"
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
          <Icon path={mdiPlus} size={0.4} className="inline mr-0.5" />Goal
        </button>
      </div>
      {creating && (
        <div className="mt-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2" data-testid="folder-goal-create">
          <GoalForm onSubmit={submit} onCancel={() => setCreating(false)} />
        </div>
      )}
    </div>
  );
}
