/**
 * GoalDetailClaim — `shell-overlay-route` claim for
 * `/folder/:encodedCwd/goals/:goalId`.
 *
 * Goal detail (mockup screen C), lighter v1: a definition panel (objective,
 * status controls, criteria) + a linked-sessions list. Each linked session
 * opens its REAL chat via in-app `navigate('/session/:id')` — including
 * auto-hidden driver/worker sessions, which stay `hidden` in the sidebar
 * (we never touch their hidden flag). Controls: `+ New session` (spawn +
 * goalId stamp at register), `Link existing…`, unlink, `⚑ driver` tag.
 *
 * See change: add-goals-folder-page (tasks 4.1, 4.3, 4.4);
 * align-ui-with-theme-tokens (tints, 12 px text, 44/32 px targets, focus-ring).
 */

import { sendPluginAction, useAllSessions, useSessionEvents, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { GoalCriterion, GoalRecordStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft, mdiBroom, mdiCheck, mdiClose, mdiLinkVariant, mdiOpenInNew, mdiPause, mdiPlay, mdiPlus, mdiRefresh, mdiTrashCanOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { GOAL_PLUGIN_ID } from "../shared/goal-types.js";
import { deriveSnapshot, fmtUsd, gaugePct, resolveGoalTurns } from "./goal-state.js";
import {
  decodeFolderPath,
  deleteGoal,
  goalsBoardUrl,
  linkSession,
  spawnSession,
  unlinkSession,
  updateGoal,
} from "./goals-api.js";
import { statusMeta, useGoals } from "./useGoals.js";

const STATUS_ACTIONS: { status: GoalRecordStatus; label: string }[] = [
  { status: "pursuing", label: "Pursuing" },
  { status: "paused", label: "Paused" },
  { status: "achieved", label: "Achieved" },
];


/**
 * Identity tint for a verdict pill in the timeline (tint fg on its own tint
 * bg). See change: align-ui-with-theme-tokens (D2).
 */
function verdictCls(verdict: string): string {
  if (verdict === "satisfied") return "text-[var(--tint-green-fg)] border-[var(--tint-green-border)] bg-[var(--tint-green-bg)]";
  if (verdict === "paused") return "text-[var(--tint-orange-fg)] border-[var(--tint-orange-border)] bg-[var(--tint-orange-bg)]";
  return "text-[var(--tint-purple-fg)] border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)]";
}

export interface GoalDetailClaimProps {
  params: Record<string, string>;
  onBack: () => void;
}

export function GoalDetailClaim({ params, onBack }: GoalDetailClaimProps): React.ReactElement {
  const cwd = decodeFolderPath(params.encodedCwd ?? "") ?? "";
  const t = useT();
  const goalId = params.goalId ?? "";
  const [, navigate] = useLocation();
  const { goals, loading, error, refetch } = useGoals(cwd);
  const allSessions = useAllSessions();
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [subgoalDraft, setSubgoalDraft] = useState("");

  const goal = useMemo(() => goals.find((g) => g.id === goalId), [goals, goalId]);
  const driverSessionId = goal?.driverSessionId;
  const driverEvents = useSessionEvents(driverSessionId ?? "");
  const snap = driverSessionId ? deriveSnapshot(driverEvents) : null;

  const dispatch = (action: string, payload?: Record<string, unknown>): void => {
    if (!driverSessionId) {
      setActionErr(t("noDriverSession", undefined, "No driver session to control. Start or link one first."));
      return;
    }
    sendPluginAction(GOAL_PLUGIN_ID, driverSessionId, action, payload);
  };

  const toggleCriterion = (i: number): void => {
    if (!goal) return;
    const next: GoalCriterion[] = goal.criteria.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c));
    void run(() => updateGoal(cwd, goal.id, { criteria: next }));
  };

  const addSubgoal = (): void => {
    const text = subgoalDraft.trim();
    if (!text || !goal || busy) return;
    dispatch("subgoal", { goal: text });
    void run(() => updateGoal(cwd, goal.id, { criteria: [...goal.criteria, { text, done: false }] }));
    setSubgoalDraft("");
  };

  const removeGoal = async (): Promise<void> => {
    if (!goal) return;
    if (!window.confirm(t("deleteGoalConfirm", { objective: goal.objective }, `Delete goal “${goal.objective}”? Linked sessions are unlinked.`))) return;
    await run(() => deleteGoal(cwd, goal.id));
    navigate(goalsBoardUrl(cwd));
  };

  // Running sessions in this folder not already linked → "Link existing…" options.
  const linkable = useMemo(
    () => allSessions.filter((s) => s.cwd === cwd && !(goal?.sessionIds ?? []).includes(s.id)),
    [allSessions, cwd, goal?.sessionIds],
  );

  const sessionLabel = (sid: string): string => {
    const s = allSessions.find((x) => x.id === sid);
    return s?.name || sid.slice(0, 8);
  };

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setActionErr(null);
    try {
      await fn();
      refetch();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : t("actionFailed", undefined, "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center gap-2 flex-shrink-0">
      <button type="button" onClick={onBack} className="focus-ring inline-flex items-center justify-center rounded min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" title={t("back", undefined, "Back")} aria-label={t("back", undefined, "Back")}>
        <Icon path={mdiArrowLeft} size={0.7} />
      </button>
      <button
        type="button"
        onClick={() => navigate(goalsBoardUrl(cwd))}
        className="focus-ring inline-flex items-center min-h-[44px] sm:min-h-[32px] px-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
      >
        {t("goalsBreadcrumb", undefined, "Goals")}
      </button>
      <span aria-hidden="true" className="text-[var(--text-muted)]">›</span>
      <span className="text-sm font-medium text-[var(--text-primary)] flex-1 truncate">
        {goal?.objective ?? t("goalFallback", undefined, "Goal")}
      </span>
      <button type="button" onClick={refetch} className="focus-ring inline-flex items-center justify-center rounded min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" title={t("refresh", undefined, "Refresh")} aria-label={t("refresh", undefined, "Refresh")}>
        <Icon path={mdiRefresh} size={0.6} />
      </button>
    </div>
  );

  if (!goal) {
    return (
      <div className="flex flex-col h-full overflow-hidden" data-testid="goal-detail-page">
        {header}
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
          {loading ? t("loadingGoal", undefined, "Loading goal…") : error ? error : t("goalNotFound", undefined, "Goal not found.")}
        </div>
      </div>
    );
  }

  const meta = statusMeta(goal.status);
  const { turnsUsed, maxTurns } = resolveGoalTurns(snap, goal);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="goal-detail-page">
      {header}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        {actionErr && <div className="text-[12px] text-[var(--severity-error-fg)]" data-testid="goal-detail-error">{actionErr}</div>}
        {/* Definition panel */}
        <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3" data-testid="goal-definition">
          <div className="text-sm text-[var(--text-primary)] font-medium">{goal.objective}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={`text-[11px] font-semibold px-1.5 py-px rounded-full border ${meta.cls}`}>{meta.dot} {meta.label}</span>
            <span className="flex-1" />
            {STATUS_ACTIONS.map((a) => (
              <button
                key={a.status}
                type="button"
                disabled={busy || goal.status === a.status}
                onClick={() => void run(() => updateGoal(cwd, goal.id, { status: a.status }))}
                className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Loop-control bar (task 5.1) — dispatches via existing plugin_action. */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap" data-testid="goal-loop-controls">
            <button type="button" disabled={busy} onClick={() => dispatch("pause")} className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" data-testid="goal-ctl-pause">
              <Icon path={mdiPause} size={0.55} />{t("pause", undefined, "Pause")}
            </button>
            <button type="button" disabled={busy} onClick={() => dispatch("resume")} className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" data-testid="goal-ctl-resume">
              <Icon path={mdiPlay} size={0.55} />{t("resume", undefined, "Resume")}
            </button>
            <button type="button" disabled={busy} onClick={() => dispatch("done")} className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" data-testid="goal-ctl-done">
              <Icon path={mdiCheck} size={0.55} />{t("done", undefined, "Done")}
            </button>
            <button type="button" disabled={busy} onClick={() => dispatch("clear")} className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40" data-testid="goal-ctl-clear">
              <Icon path={mdiBroom} size={0.55} />{t("clear", undefined, "Clear")}
            </button>
            <span className="flex-1" />
            <button type="button" disabled={busy} onClick={() => void removeGoal()} className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)] hover:bg-[color-mix(in_srgb,var(--tint-red-bg)_70%,var(--tint-red-border))] disabled:opacity-40" data-testid="goal-detail-delete">
              <Icon path={mdiTrashCanOutline} size={0.55} />{t("delete", undefined, "Delete")}
            </button>
          </div>

          {/* Dual budget gauges (task 5.1) — turns live, spend from cap. */}
          <div className="grid grid-cols-2 gap-3 mt-3" data-testid="goal-budget-gauges">
            <div data-testid="goal-gauge-turns">
              <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
                <span>{t("turns", undefined, "Turns")}</span>
                <span className="font-mono">{`${turnsUsed ?? "—"}/${maxTurns ?? "—"}`}</span>
              </div>
              <div className="h-1.5 rounded bg-[var(--tint-purple-bg)] overflow-hidden mt-0.5">
                <div className="h-full bg-[var(--tint-purple-fg)]" data-testid="goal-gauge-turns-fill" style={{ width: `${gaugePct(turnsUsed, maxTurns)}%` }} />
              </div>
            </div>
            <div data-testid="goal-gauge-spend">
              <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
                <span>{t("spend", undefined, "Spend")}</span>
                <span className="font-mono">{goal.budget?.maxSpendUsd !== undefined ? `${fmtUsd(goal.totalSpendUsd)} / ${fmtUsd(goal.budget.maxSpendUsd)}` : `${fmtUsd(goal.totalSpendUsd)} · ${t("noCap", undefined, "no cap")}`}</span>
              </div>
              <div className="h-1.5 rounded bg-[var(--tint-green-bg)] overflow-hidden mt-0.5">
                {goal.budget?.maxSpendUsd !== undefined && (
                  <div className="h-full bg-[var(--tint-green-fg)]" data-testid="goal-gauge-spend-fill" style={{ width: `${gaugePct(goal.totalSpendUsd, goal.budget.maxSpendUsd)}%` }} />
                )}
              </div>
            </div>
          </div>

          {/* Editable criteria (task 5.1) + add-subgoal. */}
          <div className="mt-3" data-testid="goal-criteria-editor">
            <div className="text-[12px] font-semibold text-[var(--text-secondary)] mb-1">{t("criteria", undefined, "Criteria")}</div>
            {goal.criteria.length > 0 && (
              <ul className="space-y-0.5">
                {goal.criteria.map((c, i) => (
                  <li key={i} className="text-[12px] text-[var(--text-secondary)] flex items-center gap-1">
                    <button type="button" onClick={() => toggleCriterion(i)} disabled={busy} aria-pressed={c.done} className="focus-ring inline-flex items-center justify-center rounded min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" data-testid="goal-criterion-toggle">
                      {c.done ? "☑" : "☐"}
                    </button>
                    <span className={c.done ? "line-through opacity-60" : ""}>{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-1 mt-1">
              <input
                value={subgoalDraft}
                onChange={(e) => setSubgoalDraft(e.target.value)}
                placeholder={t("addCriterionPlaceholder", undefined, "Add criterion / subgoal…")}
                className="flex-1 min-w-0 text-[12px] px-2 min-h-[44px] sm:min-h-[32px] rounded-md bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-[var(--focus-ring)]"
                onKeyDown={(e) => { if (e.key === "Enter") addSubgoal(); }}
                data-testid="goal-subgoal-input"
              />
              <button type="button" onClick={addSubgoal} disabled={!subgoalDraft.trim()} className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)] text-[var(--tint-purple-fg)] hover:bg-[color-mix(in_srgb,var(--tint-purple-bg)_70%,var(--tint-purple-border))] disabled:opacity-50" data-testid="goal-subgoal-add">
                {t("add", undefined, "Add")}
              </button>
            </div>
          </div>
        </section>

        {/* Judge verdict timeline (task 5.2). */}
        <section data-testid="goal-verdict-timeline">
          <div className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">{t("judgeVerdicts", undefined, "Judge verdicts")}</div>
          {!goal.verdicts || goal.verdicts.length === 0 ? (
            <div className="text-[12px] text-[var(--text-secondary)]" data-testid="goal-verdict-empty">{t("noVerdicts", undefined, "No verdicts recorded yet.")}</div>
          ) : (
            <ul className="space-y-1">
              {[...goal.verdicts].reverse().map((v, i) => (
                <li key={i} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" data-testid="goal-verdict-row">
                  <span className="font-mono text-[var(--text-secondary)]">t{v.turn}</span>
                  <span className={`px-1.5 py-px rounded-full border text-[11px] font-semibold ${verdictCls(v.verdict)}`}>{v.verdict}</span>
                  {v.note && <span className="truncate text-[var(--text-secondary)]">{v.note}</span>}
                  <span className="flex-1" />
                  <span className="text-[11px] text-[var(--text-secondary)]">{new Date(v.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Linked sessions */}
        <section data-testid="goal-linked-sessions">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{t("linkedSessions", { count: goal.sessionIds.length }, `Linked sessions (${goal.sessionIds.length})`)}</span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => spawnSession(cwd, goal.id))}
              className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)] text-[var(--tint-purple-fg)] hover:bg-[color-mix(in_srgb,var(--tint-purple-bg)_70%,var(--tint-purple-border))] disabled:opacity-50"
              data-testid="goal-new-session"
            >
              <Icon path={mdiPlus} size={0.55} />{t("newSession", undefined, "New session")}
            </button>
            <button
              type="button"
              onClick={() => setLinking((v) => !v)}
              aria-expanded={linking}
              className="focus-ring inline-flex items-center gap-1 px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              data-testid="goal-link-existing"
            >
              <Icon path={mdiLinkVariant} size={0.55} />{t("linkExisting", undefined, "Link existing…")}
            </button>
          </div>

          {linking && (
            <div className="mb-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 space-y-1" data-testid="goal-link-picker">
              {linkable.length === 0 && <div className="text-[12px] text-[var(--text-secondary)]">{t("noRunningSessions", undefined, "No other running sessions in this folder.")}</div>}
              {linkable.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => { await linkSession(cwd, goal.id, s.id); setLinking(false); })}
                  className="focus-ring block w-full text-left px-2 min-h-[44px] sm:min-h-[32px] rounded text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] truncate"
                >
                  {s.name || s.id.slice(0, 8)}
                </button>
              ))}
            </div>
          )}

          {goal.sessionIds.length === 0 ? (
            <div className="text-[12px] text-[var(--text-secondary)]">{t("noSessionsLinked", undefined, "No sessions linked yet.")}</div>
          ) : (
            <ul className="space-y-1">
              {goal.sessionIds.map((sid) => (
                <li
                  key={sid}
                  className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1"
                  data-testid="goal-session-row"
                >
                  {sid === goal.driverSessionId && <span className="text-[12px] text-[var(--text-secondary)]" title={t("driver", undefined, "driver")}>⚑</span>}
                  <span className="flex-1 text-[12px] text-[var(--text-secondary)] truncate font-mono">{sessionLabel(sid)}</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/session/${encodeURIComponent(sid)}`)}
                    aria-label={t("openChat", undefined, "Open chat")}
                    className="focus-ring inline-flex items-center justify-center rounded min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    title={t("openChat", undefined, "Open chat")}
                    data-testid="goal-open-session"
                  >
                    <Icon path={mdiOpenInNew} size={0.5} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => unlinkSession(cwd, goal.id, sid))}
                    aria-label={t("unlink", undefined, "Unlink")}
                    className="focus-ring inline-flex items-center justify-center rounded min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] text-[var(--text-secondary)] hover:bg-[var(--tint-red-bg)] hover:text-[var(--tint-red-fg)] disabled:opacity-50"
                    title={t("unlink", undefined, "Unlink")}
                    data-testid="goal-unlink-session"
                  >
                    <Icon path={mdiClose} size={0.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
