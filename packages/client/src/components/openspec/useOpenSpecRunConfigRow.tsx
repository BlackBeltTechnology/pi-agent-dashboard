/**
 * useOpenSpecRunConfigRow — the shared "Runs with" run-config row plus the
 * confirm-before-send gate for the three OpenSpec launch dialogs (Explore /
 * Propose / New Change).
 *
 * Returns the row element (model + effort selectors, sticky-side-effect
 * disclosure, and the pending status region) together with a `submit(finalize)`
 * gate and a `sending` flag the host dialog uses to disable its action.
 *
 * The gate (design Decision 4, validated by the Task 1 spike) exists because
 * the bridge's WebSocket pump dispatches handlers concurrently — a prompt sent
 * immediately after `set_model` races the model change and runs on the OLD
 * model. So when either control changed we emit `set_model` /
 * `set_thinking_level`, then wait until the session REPORTS the new
 * `(model, thinkingLevel)` pair (surfaced here as the reactive context values,
 * which update on the bridge's `model_update`) before sending the prompt.
 *
 * See change: openspec-dialog-model-effort-selector.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useModelConfig } from "../../lib/state/ModelConfigContext.js";
import { PopoverBoundaryProvider } from "../../lib/state/PopoverBoundaryContext.js";
import { ModelSelector } from "../settings/ModelSelector.js";
import { ThinkingLevelSelector } from "../settings/ThinkingLevelSelector.js";

/** Default window (ms) to wait for the session to confirm the model change. */
export const RUN_CONFIG_CONFIRM_TIMEOUT_MS = 8_000;

interface PendingSend {
  /** Chosen model label we're waiting for, or undefined when model unchanged. */
  model?: string;
  /** Chosen level we're waiting for, or undefined when level unchanged. */
  level?: string;
  finalize: () => void;
}

export interface UseOpenSpecRunConfigRow {
  /** The rendered run-config row (selectors + disclosure + status). */
  rowElement: React.ReactNode;
  /** Gate the prompt: emit changes, wait for confirmation, then `finalize()`. */
  submit: (finalize: () => void) => void;
  /** True while waiting for confirmation — the dialog disables its action. */
  sending: boolean;
}

export function useOpenSpecRunConfigRow(
  options?: { timeoutMs?: number },
): UseOpenSpecRunConfigRow {
  const timeoutMs = options?.timeoutMs ?? RUN_CONFIG_CONFIRM_TIMEOUT_MS;
  const cfg = useModelConfig();

  // Draft selections. Start from the session values; keep tracking the session
  // while the user hasn't touched a control (scenario: session model changes
  // from another surface while the dialog is open).
  const [draftModel, setDraftModel] = useState<string | undefined>(cfg.model);
  const [draftLevel, setDraftLevel] = useState<string | undefined>(cfg.thinkingLevel);
  const touchedModel = useRef(false);
  const touchedLevel = useRef(false);
  const [pending, setPending] = useState<PendingSend | null>(null);

  useEffect(() => {
    if (!touchedModel.current) setDraftModel(cfg.model);
  }, [cfg.model]);
  useEffect(() => {
    if (!touchedLevel.current) setDraftLevel(cfg.thinkingLevel);
  }, [cfg.thinkingLevel]);

  // Request a fresh model list once when the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount.
  useEffect(() => {
    cfg.refreshModels();
  }, []);

  const modelDirty = draftModel != null && draftModel !== cfg.model;
  const levelDirty = draftLevel != null && draftLevel !== cfg.thinkingLevel;
  const dirty = modelDirty || levelDirty;

  const onSelectModel = useCallback(
    (label: string) => {
      touchedModel.current = label !== cfg.model;
      setDraftModel(label);
    },
    [cfg.model],
  );
  const onSelectLevel = useCallback(
    (level: string) => {
      touchedLevel.current = level !== cfg.thinkingLevel;
      setDraftLevel(level);
    },
    [cfg.thinkingLevel],
  );

  const submit = useCallback(
    (finalize: () => void) => {
      const mDirty = draftModel != null && draftModel !== cfg.model;
      const lDirty = draftLevel != null && draftLevel !== cfg.thinkingLevel;
      if (!mDirty && !lDirty) {
        finalize();
        return;
      }
      if (mDirty && draftModel) cfg.setModel(draftModel);
      if (lDirty && draftLevel) cfg.setThinkingLevel(draftLevel);
      setPending({
        model: mDirty ? draftModel : undefined,
        level: lDirty ? draftLevel : undefined,
        finalize,
      });
    },
    [cfg, draftModel, draftLevel],
  );

  // Confirmation watcher: the session reported the new pair → send the prompt.
  useEffect(() => {
    if (!pending) return;
    const modelOk = pending.model == null || cfg.model === pending.model;
    const levelOk = pending.level == null || cfg.thinkingLevel === pending.level;
    if (modelOk && levelOk) {
      pending.finalize();
      setPending(null);
    }
  }, [pending, cfg.model, cfg.thinkingLevel]);

  // Timeout: send anyway and inform the user the model may not have applied
  // (design Risk 6 — a failed model change is indistinguishable from a slow one).
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      cfg.notify(
        i18nT(
          "openspec.runConfigTimeout",
          undefined,
          "Sent — the model change may not have applied yet.",
        ),
      );
      pending.finalize();
      setPending(null);
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [pending, cfg, timeoutMs]);

  const sending = pending != null;
  const modelsUnavailable = !cfg.models || cfg.models.length === 0;

  const rowElement = useMemo(
    () => (
      <OpenSpecRunConfigRowView
        model={draftModel}
        models={cfg.models}
        level={draftLevel}
        favorites={cfg.favorites}
        onSelectModel={onSelectModel}
        onSelectLevel={onSelectLevel}
        onToggleFavorite={cfg.toggleFavorite}
        onRefresh={cfg.refreshModels}
        dirty={dirty}
        sending={sending}
        modelsUnavailable={modelsUnavailable}
      />
    ),
    [
      draftModel,
      draftLevel,
      cfg.models,
      cfg.favorites,
      cfg.toggleFavorite,
      cfg.refreshModels,
      onSelectModel,
      onSelectLevel,
      dirty,
      sending,
      modelsUnavailable,
    ],
  );

  return { rowElement, submit, sending };
}

interface RowViewProps {
  model?: string;
  models?: import("@blackbelt-technology/pi-dashboard-shared/types.js").ModelInfo[];
  level?: string;
  favorites?: string[];
  onSelectModel: (label: string) => void;
  onSelectLevel: (level: string) => void;
  onToggleFavorite: (label: string, makeFavorite: boolean) => void;
  onRefresh: () => void;
  dirty: boolean;
  sending: boolean;
  modelsUnavailable: boolean;
}

function OpenSpecRunConfigRowView({
  model,
  models,
  level,
  favorites,
  onSelectModel,
  onSelectLevel,
  onToggleFavorite,
  onRefresh,
  dirty,
  sending,
  modelsUnavailable,
}: RowViewProps) {
  // Boundary for the selector popovers: the dialog panel, so they flip upward
  // at the dialog's bottom edge instead of overflowing it.
  const containerRef = useRef<HTMLDivElement>(null);
  const boundaryRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    boundaryRef.current = containerRef.current?.closest('[role="dialog"]') as HTMLElement | null;
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="run-config-row"
      className="mt-3 pt-3 border-t border-[var(--border-secondary)]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {i18nT("openspec.runsWith", undefined, "Runs with")}
        </span>
        <PopoverBoundaryProvider value={boundaryRef}>
          {/* `fieldset[disabled]` disables every nested control for pointer AND
              keyboard users while the confirm-gate is pending (spec: both
              selectors disabled). Reset the default fieldset chrome. */}
          <fieldset
            disabled={sending}
            data-testid="run-config-controls"
            className={`flex flex-wrap items-center gap-2 m-0 min-w-0 border-0 p-0 ${sending ? "opacity-50" : ""}`}
          >
            <ModelSelector
              current={model}
              models={models}
              onSelect={onSelectModel}
              onRefresh={onRefresh}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
              placeholder={i18nT("openspec.sessionModel", undefined, "session model")}
            />
            <ThinkingLevelSelector current={level} onSelect={onSelectLevel} />
          </fieldset>
        </PopoverBoundaryProvider>
      </div>
      {modelsUnavailable && (
        <p
          data-testid="run-config-model-loading"
          className="mt-1 text-[11px] text-[var(--text-tertiary)]"
        >
          {i18nT(
            "openspec.runConfigModelsLoading",
            undefined,
            "Loading models… the session's current model will be used.",
          )}
        </p>
      )}
      {dirty && (
        <p
          data-testid="run-config-disclosure"
          className="mt-1 text-[11px] text-[var(--text-tertiary)]"
        >
          {i18nT(
            "openspec.runConfigDisclosure",
            undefined,
            "Model & effort change for this session, not just this run.",
          )}
        </p>
      )}
      {sending && (
        <p
          data-testid="run-config-status"
          role="status"
          aria-live="polite"
          className="mt-1 text-[11px] text-[var(--text-tertiary)]"
        >
          {i18nT(
            "openspec.runConfigApplying",
            undefined,
            "Applying model & effort to the session, then sending…",
          )}
        </p>
      )}
    </div>
  );
}
