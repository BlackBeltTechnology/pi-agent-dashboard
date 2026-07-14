/**
 * GoalsBoardClaim — `shell-overlay-route` claim for `/folder/:encodedCwd/goals`.
 *
 * Full-page goals board, structured like the OpenSpec board: header
 * (back / refresh / + New Goal), a status filter bar, then goal cards
 * (objective, status badge, progress = turns n/m + criteria, expandable
 * linked-sessions). Plugin-local; no App.tsx edit.
 *
 * See change: add-goals-folder-page (tasks 4.1, 4.2). Mockup screen B.
 */

import { useSessionEvents, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { GoalRecord, GoalRecordStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft, mdiChevronDown, mdiChevronRight, mdiPlus, mdiRefresh, mdiTrashCanOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CreateGoalDialog } from "./CreateGoalDialog.js";
import { deriveSnapshot } from "./goal-state.js";
import { decodeFolderPath, deleteGoal, goalDetailUrl } from "./goals-api.js";
import { statusMeta, useGoals } from "./useGoals.js";

const FILTERS: { id: "all" | GoalRecordStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pursuing", label: "Pursuing" },
  { id: "respawning", label: "Respawning" },
  { id: "paused", label: "Paused" },
  { id: "achieved", label: "Achieved" },
  // Terminal supervisor verdict (crash-loop breaker). See change:
  // add-goal-session-supervisor.
  { id: "failed", label: "Failed" },
];

/** Small circular turn-progress ring for the driver session (task 5.3). */
function TurnRing({ used, max }: { used: number; max: number }): React.ReactElement {
  const t = useT();
  const pct = max > 0 ? Math.min(1, used / max) : 0;
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span data-testid="goal-turn-ring" title={t("turnsTooltip", { used, max }, `${used}/${max} turns`)} className="inline-flex items-center">
      <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="2" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="text-indigo-400" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Reactive live-turn rollup for a goal's driver session (task 5.3): ring +
 *  turns text + latest live verdict. */
function GoalLiveProgress({ sessionId }: { sessionId?: string }): React.ReactElement | null {
  const events = useSessionEvents(sessionId ?? "");
  if (!sessionId) return null;
  const snap = deriveSnapshot(events);
  if (!snap) return null;
  return (
    <span className="inline-flex items-center gap-1" data-testid="goal-live-progress">
      <TurnRing used={snap.turnsUsed} max={snap.maxTurns} />
      <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
        {snap.status === "paused" ? "⏸" : "●"} {snap.turnsUsed}/{snap.maxTurns}
      </span>
      {snap.lastVerdict && (
        <span className="text-[9px] px-1 py-px rounded-full border border-[var(--border-subtle)] text-[var(--text-tertiary)]" data-testid="goal-card-verdict">
          {snap.lastVerdict}
        </span>
      )}
    </span>
  );
}

function GoalCard({ goal, onOpen, onDelete }: { goal: GoalRecord; onOpen: () => void; onDelete: () => void }): React.ReactElement {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const meta = statusMeta(goal.status);
  const doneCriteria = goal.criteria.filter((c) => c.done).length;
  const lastVerdict = goal.verdicts && goal.verdicts.length > 0 ? goal.verdicts[goal.verdicts.length - 1] : undefined;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3" data-testid="goal-card">
      <div className="flex items-start gap-2">
        <button onClick={onOpen} className="flex-1 text-left min-w-0" data-testid="goal-card-open">
          <div className="text-sm text-[var(--text-primary)] font-medium truncate">{goal.objective}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-px rounded-full border ${meta.cls}`}>
              {meta.dot} {meta.label}
            </span>
            <GoalLiveProgress sessionId={goal.driverSessionId} />
            {goal.criteria.length > 0 && (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {t("criteriaCount", { done: doneCriteria, total: goal.criteria.length }, `${doneCriteria}/${goal.criteria.length} criteria`)}
              </span>
            )}
            {!goal.driverSessionId && lastVerdict && (
              <span className="text-[9px] px-1 py-px rounded-full border border-[var(--border-subtle)] text-[var(--text-tertiary)]" data-testid="goal-card-verdict">
                {lastVerdict.verdict}
              </span>
            )}
          </div>
          {goal.budget?.maxSpendUsd !== undefined && (
            <div className="mt-1.5" data-testid="goal-card-spend">
              <div className="h-1 rounded bg-[var(--border-subtle)] overflow-hidden">
                <div className="h-full bg-emerald-400/60" style={{ width: "0%" }} />
              </div>
              <span className="text-[9px] text-[var(--text-muted)]">{t("budgetAmount", { amount: goal.budget.maxSpendUsd }, `budget $${goal.budget.maxSpendUsd}`)}</span>
            </div>
          )}
        </button>
        {goal.sessionIds.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-[10px] flex items-center gap-0.5"
            data-testid="goal-card-expand"
          >
            <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.5} />
            {goal.sessionIds.length}
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-[var(--text-muted)] hover:text-red-400"
          title={t("deleteGoal", undefined, "Delete goal")}
          data-testid="goal-card-delete"
        >
          <Icon path={mdiTrashCanOutline} size={0.55} />
        </button>
      </div>
      {goal.criteria.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {goal.criteria.map((c, i) => (
            <li key={i} className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
              <span>{c.done ? "☑" : "☐"}</span>
              <span className={c.done ? "line-through opacity-60" : ""}>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      {expanded && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--border-subtle)] pt-2" data-testid="goal-card-sessions">
          {goal.sessionIds.map((sid) => (
            <li key={sid} className="text-[10px] font-mono text-[var(--text-tertiary)] flex items-center gap-1">
              {sid === goal.driverSessionId && <span title={t("driver", undefined, "driver")}>⚑</span>}
              <span className="truncate">{sid}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface GoalsBoardClaimProps {
  params: Record<string, string>;
  onBack: () => void;
}

export function GoalsBoardClaim({ params, onBack }: GoalsBoardClaimProps): React.ReactElement {
  const t = useT();
  const cwd = decodeFolderPath(params.encodedCwd ?? "") ?? "";
  const [, navigate] = useLocation();
  const { goals, loading, error, refetch } = useGoals(cwd);
  const [filter, setFilter] = useState<"all" | GoalRecordStatus>("all");
  const [creating, setCreating] = useState(false);
  const [mutErr, setMutErr] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? goals : goals.filter((g) => g.status === filter)),
    [goals, filter],
  );

  const remove = async (goal: GoalRecord): Promise<void> => {
    if (!cwd) return;
    if (!window.confirm(t("deleteGoalConfirm", { objective: goal.objective }, `Delete goal “${goal.objective}”? Linked sessions are unlinked.`))) return;
    try {
      await deleteGoal(cwd, goal.id);
      setMutErr(null);
      refetch();
    } catch (e) {
      setMutErr(e instanceof Error ? e.message : t("deleteFailed", undefined, "Delete failed"));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="goals-board-page">
      <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center gap-2 flex-shrink-0">
        <button onClick={onBack} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title={t("back", undefined, "Back")}>
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <span className="text-sm font-medium text-[var(--text-primary)] flex-1 truncate">
          {t("goalsBoardTitle", { folder: cwd.split("/").pop() || cwd }, `Goals · ${cwd.split("/").pop() || cwd}`)}
        </span>
        <button onClick={refetch} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title={t("refresh", undefined, "Refresh")}>
          <Icon path={mdiRefresh} size={0.6} />
        </button>
        <button
          onClick={() => setCreating((v) => !v)}
          className="text-[11px] px-2 py-0.5 rounded border text-indigo-400 border-indigo-500/40 bg-indigo-500/5 hover:border-indigo-500/70 flex items-center gap-1"
          data-testid="goals-board-new"
        >
          <Icon path={mdiPlus} size={0.5} />{t("newGoal", undefined, "New Goal")}
        </button>
      </div>

      {creating && cwd && (
        <CreateGoalDialog
          cwd={cwd}
          onClose={() => setCreating(false)}
          onCreated={() => refetch()}
        />
      )}

      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center gap-1.5 flex-shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${filter === f.id ? "text-indigo-300 border-indigo-500/70 bg-indigo-500/10" : "text-[var(--text-tertiary)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]"}`}
            data-testid={`goals-filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {error && <div className="text-xs text-red-400">{error}</div>}
        {mutErr && <div className="text-xs text-red-400" data-testid="goals-board-mutation-error">{mutErr}</div>}
        {!error && loading && goals.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]">{t("loadingGoals", undefined, "Loading goals…")}</div>
        )}
        {!loading && visible.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]" data-testid="goals-empty">
            {goals.length === 0 ? t("noGoalsYet", undefined, "No goals yet. Create one with + New Goal.") : t("noGoalsMatch", undefined, "No goals match this filter.")}
          </div>
        )}
        {visible.map((g) => (
          <GoalCard key={g.id} goal={g} onOpen={() => navigate(goalDetailUrl(cwd, g.id))} onDelete={() => void remove(g)} />
        ))}
      </div>
    </div>
  );
}
