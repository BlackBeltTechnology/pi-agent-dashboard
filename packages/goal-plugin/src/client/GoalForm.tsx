/**
 * GoalForm — Screen A rich goal authoring form.
 *
 * Captures the full goal definition: objective, editable acceptance criteria,
 * judge-model selection (cross-model by default; self-judge toggle), and a
 * turn/spend budget. Reused by the folder nav create slot
 * (`FolderGoalsSection`) and the board's `+ New Goal` flow (`GoalsBoardClaim`)
 * so both surfaces submit the same payload to `createGoal`.
 *
 * Judge-model options come from the dashboard's known/favorite model list
 * (`/api/favorite-models`). Absent fields are omitted so the server keeps its
 * "behave exactly as before" contract for legacy/minimal goals.
 *
 * See change: sophisticate-goal-authoring-and-control (tasks 4.1, 4.2).
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { GoalBudget, GoalCriterion, GoalJudge } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClose, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { getAutoRespawnDefault } from "./goal-settings.js";
import { parseModelLabel } from "./goals-api.js";
import { useJudgeModels } from "./useJudgeModels.js";

export interface GoalFormPayload {
  objective: string;
  criteria?: GoalCriterion[];
  budget?: GoalBudget;
  judge?: GoalJudge;
  /** Auto-respawn the driver on death (progress-gated, budget/breaker-bounded).
   *  See change: add-goal-session-supervisor. */
  autoRespawn?: boolean;
}

export interface GoalFormProps {
  /** Pre-fill (edit mode). Omit for create. */
  initial?: GoalFormPayload;
  submitLabel?: string;
  onSubmit: (payload: GoalFormPayload) => Promise<void> | void;
  onCancel?: () => void;
  /** Executor model label, when known, to flag cross-model judges. */
  executorModel?: string;
  /** Default for the autoRespawn toggle in create mode (from plugin settings). */
  autoRespawnDefault?: boolean;
}

export function GoalForm({ initial, submitLabel, onSubmit, onCancel, executorModel, autoRespawnDefault }: GoalFormProps): React.ReactElement {
  const t = useT();
  const { models } = useJudgeModels();
  const [objective, setObjective] = useState(initial?.objective ?? "");
  const [criteria, setCriteria] = useState<string[]>(initial?.criteria?.map((c) => c.text) ?? []);
  const [maxTurns, setMaxTurns] = useState<string>(initial?.budget?.maxTurns?.toString() ?? "");
  const [maxSpendUsd, setMaxSpendUsd] = useState<string>(initial?.budget?.maxSpendUsd?.toString() ?? "");
  const [judgeLabel, setJudgeLabel] = useState<string>(
    initial?.judge ? `${initial.judge.provider}/${initial.judge.modelId}` : "",
  );
  const [selfJudge, setSelfJudge] = useState<boolean>(!!initial?.judge?.sameModel);
  const [autoRespawn, setAutoRespawn] = useState<boolean>(
    initial?.autoRespawn ?? autoRespawnDefault ?? getAutoRespawnDefault(),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const crossModel = !!judgeLabel && !selfJudge && (!executorModel || judgeLabel !== executorModel);

  const setCriterion = (i: number, v: string): void =>
    setCriteria((cur) => cur.map((c, idx) => (idx === i ? v : c)));
  const addCriterion = (): void => setCriteria((cur) => [...cur, ""]);
  const removeCriterion = (i: number): void => setCriteria((cur) => cur.filter((_, idx) => idx !== i));

  const buildPayload = (): GoalFormPayload | null => {
    const obj = objective.trim();
    if (!obj) return null;
    const cleanCriteria = criteria.map((t) => t.trim()).filter(Boolean);
    const budget: GoalBudget = {};
    const t = Number(maxTurns);
    if (maxTurns.trim() && Number.isFinite(t) && t > 0) budget.maxTurns = t;
    const s = Number(maxSpendUsd);
    if (maxSpendUsd.trim() && Number.isFinite(s) && s > 0) budget.maxSpendUsd = s;
    let judge: GoalJudge | undefined;
    if (judgeLabel) {
      const { provider, modelId } = parseModelLabel(judgeLabel);
      if (provider && modelId) judge = { provider, modelId, ...(selfJudge ? { sameModel: true } : {}) };
    }
    return {
      objective: obj,
      ...(cleanCriteria.length ? { criteria: cleanCriteria.map((text) => ({ text, done: false })) } : {}),
      ...(budget.maxTurns !== undefined || budget.maxSpendUsd !== undefined ? { budget } : {}),
      ...(judge ? { judge } : {}),
      ...(autoRespawn ? { autoRespawn: true } : {}),
    };
  };

  const submit = async (): Promise<void> => {
    const payload = buildPayload();
    if (!payload || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("failedToSave", undefined, "Failed to save goal"));
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    "w-full text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] outline-none focus:border-indigo-400";

  return (
    <div className="space-y-3" data-testid="goal-form">
      <div>
        <label className="text-[10px] uppercase font-semibold text-[var(--text-tertiary)]">{t("objective", undefined, "Objective")}</label>
        <input
          autoFocus
          data-testid="goal-form-objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder={t("objectivePlaceholder", undefined, "Goal objective…")}
          className={fieldCls}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel?.(); }}
        />
      </div>

      <div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase font-semibold text-[var(--text-tertiary)] flex-1">{t("acceptanceCriteria", undefined, "Acceptance criteria")}</label>
          <button data-testid="goal-form-add-criterion" onClick={addCriterion} className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5">
            <Icon path={mdiPlus} size={0.4} />{t("add", undefined, "Add")}
          </button>
        </div>
        {criteria.length === 0 && <div className="text-[10px] text-[var(--text-muted)] mt-1">{t("noCriteria", undefined, "No criteria — the judge uses the objective alone.")}</div>}
        <div className="space-y-1 mt-1">
          {criteria.map((c, i) => (
            <div key={i} className="flex items-center gap-1" data-testid="goal-form-criterion">
              <input value={c} onChange={(e) => setCriterion(i, e.target.value)} placeholder={t("criterionPlaceholder", { n: i + 1 }, `Criterion ${i + 1}`)} className={fieldCls} />
              <button onClick={() => removeCriterion(i)} className="text-[var(--text-tertiary)] hover:text-red-400" title={t("remove", undefined, "Remove")} data-testid="goal-form-remove-criterion">
                <Icon path={mdiClose} size={0.5} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase font-semibold text-[var(--text-tertiary)]">{t("maxTurns", undefined, "Max turns")}</label>
          <input data-testid="goal-form-max-turns" type="number" min="1" value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} placeholder="20" className={fieldCls} />
        </div>
        <div>
          <label className="text-[10px] uppercase font-semibold text-[var(--text-tertiary)]">{t("maxSpend", undefined, "Max spend ($)")}</label>
          <input data-testid="goal-form-max-spend" type="number" min="0" step="0.01" value={maxSpendUsd} onChange={(e) => setMaxSpendUsd(e.target.value)} placeholder="—" className={fieldCls} />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase font-semibold text-[var(--text-tertiary)] flex-1">{t("judgeModel", undefined, "Judge model")}</label>
          {judgeLabel && (
            <span
              data-testid="goal-form-judge-badge"
              className={`text-[9px] px-1.5 py-px rounded-full border ${crossModel ? "text-indigo-300 border-indigo-500/50 bg-indigo-500/10" : "text-amber-300 border-amber-500/50 bg-amber-500/10"}`}
            >
              {crossModel ? t("crossModel", undefined, "cross-model") : t("selfJudge", undefined, "self-judge")}
            </span>
          )}
        </div>
        <select data-testid="goal-form-judge" value={judgeLabel} onChange={(e) => setJudgeLabel(e.target.value)} className={fieldCls}>
          <option value="">{t("extensionDefault", undefined, "Extension default")}</option>
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--text-secondary)]">
          <input data-testid="goal-form-self-judge" type="checkbox" checked={selfJudge} disabled={!judgeLabel} onChange={(e) => setSelfJudge(e.target.checked)} />
          {t("selfJudgeLabel", undefined, "Self-judge (judge with the executor model)")}
        </label>
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        <input
          data-testid="goal-form-auto-respawn"
          type="checkbox"
          checked={autoRespawn}
          onChange={(e) => setAutoRespawn(e.target.checked)}
        />
        {t("autoRespawnLabel", undefined, "Auto-respawn on driver death (bounded by budget + crash-loop breaker)")}
      </label>

      {err && <div className="text-[10px] text-red-400" data-testid="goal-form-error">{err}</div>}

      <div className="flex items-center gap-2">
        <button
          data-testid="goal-form-submit"
          disabled={!objective.trim() || busy}
          onClick={() => void submit()}
          className="text-xs px-2.5 py-1 rounded border border-indigo-500/40 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {submitLabel ?? t("create", undefined, "Create")}
        </button>
        {onCancel && (
          <button data-testid="goal-form-cancel" onClick={onCancel} className="text-xs px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            {t("cancel", undefined, "Cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
