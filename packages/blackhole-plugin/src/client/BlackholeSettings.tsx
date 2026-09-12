/**
 * BlackholeSettings — settings-section slot (general tab).
 *
 * Three mutually exclusive states, all produced by THIS component (design D3 —
 * an unsatisfied `requires.piExtensions` does not deactivate a plugin, so the
 * host never withholds this surface and the not-installed state has to be ours):
 *
 *   not-installed  `pi-blackhole` absent from pi's package registry
 *   parse-error    the config file exists but cannot be parsed — NO form is
 *                  rendered, because there are no values to display and showing
 *                  defaults would misreport what the user's sessions run (D6)
 *   form           grouped scalar accordions + the per-worker chain editors
 *
 * Saving goes through the host's unified Save Bar (`useSettingsDraftSource`), so
 * this component owns no save affordance of its own — except in the parse-error
 * state, where an explicitly DISABLED save control states that editing is
 * blocked rather than leaving the absence to be inferred.
 *
 * See change: add-blackhole-plugin.
 */
import { useSettingsDraftSource, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BlackholeConfig,
  DEFAULTS,
  FIELD_DESCRIPTORS,
  KNOWN_KEYS,
  type ModelRef,
} from "../shared/blackhole-config.js";
import { normalizeModel, readChain, recommendedDefaults, writeChain } from "../shared/chain-model.js";
import {
  type ConfigOk,
  type ConfigResult,
  getConfig,
  getModels,
  isExtensionInstalled,
  putConfig,
} from "./blackhole-api.js";
import { ChainEditor, type RegistryState } from "./ChainEditor.js";
import { FIELD_GROUPS, type FieldMeta, WORKER_META } from "./field-groups.js";

const INSTALL_COMMAND = "pi install npm:pi-blackhole";

/** Keys rendered by the chain editors rather than as scalar fields. */
const CHAIN_KEYS = new Set<string>([
  "model",
  ...WORKER_META.flatMap((w) => [w.primaryKey, w.fallbackKey]),
]);

type Chains = Record<string, ModelRef[]>;

export interface Draft {
  values: Record<string, unknown>;
  chains: Chains;
  baseModel: ModelRef | null;
  /** Keys the FILE set (GET reported `isDefault: false`) at load time. */
  userSet: ReadonlySet<string>;
  /** The values observed at load, so an untouched key can be left alone. */
  loaded: Record<string, unknown>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Build the editable draft from a GET result. */
export function toDraft(cfg: ConfigOk): Draft {
  const values: Record<string, unknown> = {};
  const userSet = new Set<string>();
  for (const key of KNOWN_KEYS) {
    const view = cfg.fields[key];
    values[key] = view?.value;
    if (view && !view.isDefault) userSet.add(key);
  }
  const chains: Chains = {};
  for (const w of WORKER_META) chains[w.worker] = readChain(values, w.primaryKey, w.fallbackKey);
  const base = values.model;
  return {
    values,
    chains,
    baseModel: base && typeof base === "object" && !Array.isArray(base) ? (base as ModelRef) : null,
    userSet,
    loaded: { ...values },
  };
}

/** Structural equality, treating `null` and `undefined` as the same absence. */
function same(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) return b === undefined || b === null;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Should this key appear in the PUT body at all?
 *
 * Only when the FILE already set it, or the user changed it here. A key the file
 * omitted and the user never touched is left ABSENT: writing its default would
 * silently pin the value, so a later change to blackhole's own default would
 * stop reaching this user. "Populated with defaults" is a display affordance,
 * not an instruction to materialise them.
 */
function shouldEmit(draft: Draft, key: string, current: unknown): boolean {
  return draft.userSet.has(key) || !same(current, draft.loaded[key]);
}

/**
 * Build the PUT body: the managed scalars worth writing, plus each chain split
 * back into its `<worker>Model` / `<worker>FallbackModels` pair. `null`
 * explicitly unsets a model key — `undefined` would be dropped by
 * `JSON.stringify` and the key would silently survive on disk.
 */
export function buildPayload(draft: Draft): Record<string, unknown> {
  return { ...scalarPayload(draft), ...modelPayload(draft) };
}

/** The managed non-chain keys worth writing. */
function scalarPayload(draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    if (CHAIN_KEYS.has(key)) continue;
    const value = draft.values[key];
    // `undefined` = the key has no default and was never set; `NaN` = a cleared
    // numeric input, which is not an edit instruction the config can express.
    // Both mean "say nothing about this key", so the on-disk value stands.
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isNaN(value)) continue;
    if (!shouldEmit(draft, key, value)) continue;
    out[key] = value;
  }
  return out;
}

/** The base model plus each worker chain, split back into its key pair. */
function modelPayload(draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (shouldEmit(draft, "model", draft.baseModel)) {
    out.model = draft.baseModel
      ? normalizeModel(draft.baseModel as unknown as Record<string, unknown>)
      : null;
  }
  for (const w of WORKER_META) {
    const { primary, fallbacks } = writeChain(draft.chains[w.worker] ?? []);
    if (shouldEmit(draft, w.primaryKey, primary ?? null)) out[w.primaryKey] = primary ?? null;
    if (shouldEmit(draft, w.fallbackKey, fallbacks ?? null)) out[w.fallbackKey] = fallbacks ?? null;
  }
  return out;
}

export function BlackholeSettings(): React.ReactElement {
  const t = useT();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [result, setResult] = useState<ConfigResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>("");

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [registryState, setRegistryState] = useState<RegistryState>("pending");
  const [registryReason, setRegistryReason] = useState<string | null>(null);
  const [showConfirmDefaults, setShowConfirmDefaults] = useState(false);
  const [stagedDefaultsCount, setStagedDefaultsCount] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const ConfirmDialogPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog);

  const fetchRegistry = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await getModels("", signal);
      if (signal?.aborted) return;
      if (res.kind === "ok") {
        setModels(res.models);
        setRegistryState(res.models.length === 0 ? "empty" : "ok");
        setRegistryReason(null);
      } else {
        setModels([]);
        setRegistryState("unavailable");
        setRegistryReason(res.reason);
      }
    } catch (e) {
      if (signal?.aborted) return;
      setModels([]);
      setRegistryState("unavailable");
      setRegistryReason(errMsg(e));
    }
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    setSaveError(null);
    setStagedDefaultsCount(null);
    try {
      const present = await isExtensionInstalled("", signal);
      setInstalled(present);
      if (!present) {
        setResult(null);
        setDraft(null);
        return;
      }
      void fetchRegistry(signal);
      const cfg = await getConfig("", signal);
      setResult(cfg);
      if (cfg.status === "ok") {
        const next = toDraft(cfg);
        setDraft(next);
        setBaseline(JSON.stringify(buildPayload(next)));
      } else {
        setDraft(null);
      }
    } catch (e) {
      if (signal?.aborted) return;
      setLoadError(errMsg(e));
    }
  }, [fetchRegistry]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const retryRegistry = useCallback(async () => {
    setRegistryState("pending");
    await fetchRegistry();
  }, [fetchRegistry]);

  const setField = useCallback((key: string, value: unknown) => {
    setDraft((prev) => (prev ? { ...prev, values: { ...prev.values, [key]: value } } : prev));
  }, []);

  const setChain = useCallback((worker: string, next: ModelRef[]) => {
    setDraft((prev) => (prev ? { ...prev, chains: { ...prev.chains, [worker]: next } } : prev));
  }, []);

  const payload = useMemo(() => (draft ? buildPayload(draft) : null), [draft]);
  const isDirty = payload !== null && JSON.stringify(payload) !== baseline;

  useSettingsDraftSource({
    id: "plugin:blackhole",
    isDirty,
    commit: async () => {
      if (!payload) return;
      try {
        setSaveError(null);
        await putConfig(payload);
        await load();
      } catch (err) {
        setSaveError(errMsg(err));
        throw err;
      }
    },
    reset: () => {
      setSaveError(null);
      void load();
    },
  });

  const defaultsResult = useMemo(() => {
    return recommendedDefaults(models);
  }, [models]);

  const hasCandidate = registryState === "ok" && defaultsResult.found;

  const applyDefaults = useCallback(() => {
    const { chain, found } = recommendedDefaults(models);
    if (!found) return;

    setDraft((prev) => {
      if (!prev) return prev;
      const nextChains: Chains = {};
      for (const w of WORKER_META) {
        nextChains[w.worker] = chain.map((m) => ({ ...m }));
      }
      return {
        ...prev,
        chains: nextChains,
        values: {
          ...prev.values,
          debug: true,
          debugLog: true,
        },
      };
    });
    setStagedDefaultsCount(chain.length);
  }, [models]);

  const handleDefaultsClick = useCallback(() => {
    if (!hasCandidate) return;
    const hasAnyChainEntries = WORKER_META.some(
      (w) => (draft?.chains[w.worker]?.length ?? 0) > 0,
    );
    if (hasAnyChainEntries) {
      setShowConfirmDefaults(true);
    } else {
      applyDefaults();
    }
  }, [hasCandidate, draft, applyDefaults]);

  if (loadError) {
    return (
      <div className="text-[13px] text-[var(--accent-red)]" data-testid="blackhole-load-error">
        {t("loadError", { error: loadError }, `Failed to load config: ${loadError}`)}
      </div>
    );
  }

  if (installed === false) {
    return (
      <div className="text-[13px] text-[var(--text-secondary)]" data-testid="blackhole-not-installed">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mt-0 mb-2">
          {t("notInstalledTitle", undefined, "pi-blackhole isn't installed")}
        </h3>
        <p className="text-[12.5px] mt-0 mb-3">
          {t(
            "notInstalledBody",
            undefined,
            "This page configures the pi-blackhole extension — unified algorithmic compaction plus observational memory. Install it in any pi session, then reload.",
          )}
        </p>
        <code
          className="inline-block font-mono text-[12px] px-2.5 py-1.5 rounded bg-[var(--bg-code)] border border-[var(--border-secondary)] text-[var(--text-primary)]"
          data-testid="blackhole-install-command"
        >
          {INSTALL_COMMAND}
        </code>
      </div>
    );
  }

  if (installed === null || (result === null && !loadError)) {
    return <div className="text-[13px] text-[var(--text-muted)]">{t("loading", undefined, "Loading…")}</div>;
  }

  if (result?.status === "parse-error") {
    return (
      <div className="text-[13px] text-[var(--text-secondary)]" data-testid="blackhole-parse-error">
        <h3 className="text-[15px] font-semibold text-[var(--accent-red)] mt-0 mb-2">
          {t("parseErrorTitle", undefined, "Config file can't be parsed — editing is disabled")}
        </h3>
        <p className="text-[12.5px] mt-0 mb-2">
          {t(
            "parseErrorBody",
            undefined,
            "Blackhole's settings all live in this one file. Because it can't be read, this page has no values to display — showing defaults here would misrepresent what your sessions are actually running.",
          )}
        </p>
        <div className="font-mono text-[11px] text-[var(--text-tertiary)] mb-2" data-testid="blackhole-file-path">
          {result.filePath}
        </div>
        <pre
          className="m-0 font-mono text-[11.5px] text-[var(--accent-red)] bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded-lg p-3 overflow-auto whitespace-pre-wrap"
          data-testid="blackhole-parse-message"
        >
          {result.message}
        </pre>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            className="text-[12px] px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
            data-testid="blackhole-recheck"
            onClick={() => void load()}
          >
            {t("recheck", undefined, "Re-check file")}
          </button>
          <button
            type="button"
            disabled
            className="text-[12px] px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-tertiary)] opacity-50"
            data-testid="blackhole-save-blocked"
          >
            {t("saveBlocked", undefined, "Save")}
          </button>
        </div>
      </div>
    );
  }

  if (!draft || result?.status !== "ok") {
    return <div className="text-[13px] text-[var(--text-muted)]">{t("loading", undefined, "Loading…")}</div>;
  }

  const sessionFallback = draft.values.sessionFallback !== false;

  return (
    <div className="text-[13px] text-[var(--text-secondary)] pb-8" data-testid="blackhole-settings">
      <p className="text-[12px] mb-2">
        {t("intro", undefined, "Compaction and observational memory for the")}{" "}
        <code className="font-mono text-[11px]">pi-blackhole</code>{" "}
        {t("introTail", undefined, "extension.")}
      </p>

      <div className="font-mono text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5 mb-3">
        <span>{t("file", undefined, "File:")}</span>
        <span
          className="border border-[var(--border-secondary)] rounded px-1.5 text-[var(--accent-green)]"
          data-testid="blackhole-file-path"
        >
          {result.filePath}
        </span>
        <span>
          ·{" "}
          {result.exists
            ? t("nUnmanaged", { count: result.unmanagedKeys.length }, `${result.unmanagedKeys.length} unmanaged keys preserved`)
            : t("notCreated", undefined, "not yet created")}
        </span>
      </div>

      {/* Apply semantics: attributed to the extension, never phrased as a
          dashboard guarantee, and never demanding a restart. */}
      <p
        className="text-[12px] rounded-lg px-2.5 py-2 mb-4 border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
        data-testid="blackhole-apply-note"
      >
        {t(
          "applyNote",
          undefined,
          "pi-blackhole re-reads this file after every write, so saved changes reach running sessions on its own. Keys this page doesn't manage (including _comment notes) are preserved untouched.",
        )}
      </p>

      {FIELD_GROUPS.map((group) => (
        <details
          key={group.title}
          className="border border-[var(--border-secondary)] rounded-[10px] overflow-hidden mb-2.5 bg-[var(--bg-secondary)]"
          data-testid={`blackhole-group-${group.title}`}
        >
          <summary className="cursor-pointer flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] select-none list-none">
            {group.title}
            <span className="ml-auto text-[11px] text-[var(--text-tertiary)] font-medium">
              {group.fields.length} {t("fields", undefined, "fields")}
            </span>
          </summary>
          <div className="px-3.5 pb-3 pt-1 border-t border-[var(--border-subtle)]">
            {group.fields.map((meta) => (
              <FieldRow
                key={meta.key}
                meta={meta}
                value={draft.values[meta.key]}
                onChange={(v) => setField(meta.key, v)}
              />
            ))}
          </div>
        </details>
      ))}

      {showConfirmDefaults && (
        <ConfirmDialogPrimitive
          message={t(
            "confirmReplaceChainsBody",
            undefined,
            "Applying recommended defaults will overwrite the current fallback chains for observer, reflector, and dropper with up to 3 flash/haiku/mini models from your credentialed registry.",
          )}
          confirmLabel={t("confirmReplaceApply", undefined, "Apply Defaults")}
          onConfirm={() => {
            applyDefaults();
            setShowConfirmDefaults(false);
          }}
          onCancel={() => setShowConfirmDefaults(false)}
        />
      )}

      <ChainsSection
        draft={draft}
        models={models}
        registryState={registryState}
        registryReason={registryReason}
        saveError={saveError}
        hasCandidate={hasCandidate}
        stagedDefaultsCount={stagedDefaultsCount}
        sessionFallback={sessionFallback}
        onRetryRegistry={retryRegistry}
        onSetBaseModel={(base) =>
          setDraft((prev) => (prev ? { ...prev, baseModel: base } : prev))
        }
        onDefaultsClick={handleDefaultsClick}
        onSetChain={setChain}
      />
    </div>
  );
}

interface ChainsSectionProps {
  draft: Draft;
  models: ModelInfo[];
  registryState: RegistryState;
  registryReason: string | null;
  saveError: string | null;
  hasCandidate: boolean;
  stagedDefaultsCount: number | null;
  sessionFallback: boolean;
  onRetryRegistry: () => void;
  onSetBaseModel: (base: ModelRef | null) => void;
  onDefaultsClick: () => void;
  onSetChain: (worker: string, next: ModelRef[]) => void;
}

function ChainsSection({
  draft,
  models,
  registryState,
  registryReason,
  saveError,
  hasCandidate,
  stagedDefaultsCount,
  sessionFallback,
  onRetryRegistry,
  onSetBaseModel,
  onDefaultsClick,
  onSetChain,
}: ChainsSectionProps): React.ReactElement {
  const t = useT();
  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  return (
    <details
      open
      className="border border-[var(--border-secondary)] rounded-[10px] overflow-hidden mb-2.5 bg-[var(--bg-secondary)]"
      data-testid="blackhole-group-chains"
    >
      <summary className="cursor-pointer flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] select-none list-none">
        {t("workerModels", undefined, "Worker models")}
        <button
          type="button"
          data-testid="blackhole-registry-retry"
          aria-label={t("retryRegistry", undefined, "Retry")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void onRetryRegistry();
          }}
          className="ml-2 px-1.5 py-0.5 text-[11px] font-normal rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          {t("retryRegistry", undefined, "Retry")}
        </button>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)] font-medium">
          {WORKER_META.length} {t("chains", undefined, "chains")}
        </span>
      </summary>
      <div className="px-3.5 pb-3 pt-2 border-t border-[var(--border-subtle)]">
        <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0 mb-3">
          {t(
            "chainsHelp",
            undefined,
            "Each worker tries its models top to bottom. A model that returns a retryable error is skipped for its cooldown window, and the next one runs.",
          )}
        </p>

        {saveError && (
          <div
            data-testid="blackhole-save-error"
            className="border border-[var(--severity-error-border,#ef4444)] rounded-lg p-3 mb-3 bg-[var(--severity-error-bg,#fef2f2)] text-[var(--severity-error-fg,#b91c1c)] text-[12px]"
          >
            {saveError}
          </div>
        )}

        {registryState === "unavailable" && (
          <div
            data-testid="blackhole-registry-unavailable"
            className="border border-[var(--severity-error-border,#ef4444)] rounded-lg p-3 mb-3 bg-[var(--severity-error-bg,#fef2f2)] text-[var(--severity-error-fg,#b91c1c)] flex items-center justify-between gap-2 text-[12px]"
          >
            <span>
              ✕{" "}
              {t(
                "registryUnavailable",
                { reason: registryReason || "503" },
                `Model registry unavailable (${registryReason || "503"}).`,
              )}
            </span>
            <button
              type="button"
              data-testid="blackhole-registry-retry-banner"
              onClick={() => void onRetryRegistry()}
              className="px-2 py-0.5 text-[11px] rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {t("retryRegistry", undefined, "Retry")}
            </button>
          </div>
        )}

        {registryState === "empty" && (
          <div
            data-testid="blackhole-registry-empty"
            className="border border-[var(--severity-warning-border,#f59e0b)] rounded-lg p-3 mb-3 bg-[var(--severity-warning-bg,#fffbeb)] text-[var(--severity-warning-fg,#b45309)] text-[12px]"
          >
            ⚠️{" "}
            {t(
              "registryEmpty",
              undefined,
              "No credentialed models in registry. Configure provider API keys in Settings > Providers to enable model selection.",
            )}
          </div>
        )}

        {/* Base Model picker row (design D7) */}
        <div
          className="border border-[var(--border-secondary)] rounded-lg p-3 mb-3 bg-[var(--bg-tertiary)] flex items-center justify-between gap-3 flex-wrap"
          data-testid="blackhole-base-model-card"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                {t("baseModelLabel", undefined, "Base Model")}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">model</span>
            </div>
            <div className="text-[11px] text-[var(--text-tertiary)]">
              {t(
                "baseModelHelp",
                undefined,
                "Shared fallback for all workers before the session model.",
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {registryState === "ok" ? (
              <ModelSelectorPrimitive
                current={
                  draft.baseModel
                    ? `${draft.baseModel.provider}/${draft.baseModel.id}`
                    : undefined
                }
                models={models}
                placeholder={t("selectBaseModelPlaceholder", undefined, "Select base model…")}
                onSelect={(label: string) => {
                  const picked = models.find((m) => `${m.provider}/${m.id}` === label);
                  let provider = "";
                  let id = "";
                  if (picked) {
                    provider = picked.provider;
                    id = picked.id;
                  } else {
                    const slashIdx = label.indexOf("/");
                    provider = slashIdx >= 0 ? label.slice(0, slashIdx) : "";
                    id = slashIdx >= 0 ? label.slice(slashIdx + 1) : label;
                  }
                  onSetBaseModel({ provider, id });
                }}
              />
            ) : (
              <span
                data-testid="blackhole-base-model-value"
                className="font-mono text-[12px] text-[var(--text-primary)]"
              >
                {draft.baseModel ? `${draft.baseModel.provider}/${draft.baseModel.id}` : "—"}
              </span>
            )}
            <button
              type="button"
              data-testid="blackhole-base-model-clear"
              disabled={draft.baseModel === null}
              onClick={() => onSetBaseModel(null)}
              className="px-2 py-1 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            >
              {t("clearBaseModel", undefined, "Clear")}
            </button>
          </div>
        </div>

        {/* Recommended Defaults Action (design D6) */}
        <div
          className="border border-dashed border-[var(--border-secondary)] rounded-lg p-3 mb-3 bg-[var(--bg-tertiary)]"
          data-testid="blackhole-recommended-defaults-card"
        >
          <div className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">
            {t("recommendedDefaultsLabel", undefined, "Use recommended defaults")}
          </div>
          <p className="text-[11.5px] text-[var(--text-tertiary)] m-0 mb-2">
            {t(
              "recommendedDefaultsHelp",
              undefined,
              "Recommended defaults stages resilient flash-class chains (up to 3 models across distinct providers) for observer, reflector, and dropper, plus debug logging.",
            )}
          </p>

          {registryState !== "ok" && (
            <div className="text-[11px] text-[var(--text-tertiary)] mb-2">
              {t(
                "recommendedDefaultsDisabledUnavailable",
                undefined,
                "Registry unavailable. Staging defaults is disabled.",
              )}
            </div>
          )}

          {registryState === "ok" && !hasCandidate && (
            <div className="text-[11px] text-[var(--text-tertiary)] mb-2">
              {t(
                "recommendedDefaultsNoCandidate",
                undefined,
                "No flash, haiku, or mini models found in registry.",
              )}
            </div>
          )}

          {stagedDefaultsCount !== null && (
            <div className="text-[11px] text-[var(--accent-blue)] mb-2">
              {t(
                "recommendedDefaultsFewerThan3",
                { count: stagedDefaultsCount },
                `Staged ${stagedDefaultsCount} of 3 recommended models from available candidates.`,
              )}
            </div>
          )}

          <button
            type="button"
            disabled={!hasCandidate}
            data-testid="blackhole-recommended-defaults-btn"
            onClick={onDefaultsClick}
            className="px-2.5 py-1 text-[11.5px] rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("recommendedDefaultsLabel", undefined, "Use recommended defaults")}
          </button>
        </div>

        {WORKER_META.map((w) => (
          <ChainEditor
            key={w.worker}
            worker={w.worker}
            name={w.name}
            role={w.role}
            entries={draft.chains[w.worker] ?? []}
            onChange={(next) => onSetChain(w.worker, next)}
            baseModel={draft.baseModel}
            sessionFallback={sessionFallback}
            models={models}
            registry={registryState}
            onRetryRegistry={onRetryRegistry}
          />
        ))}
      </div>
    </details>
  );
}

// ── One scalar field row ─────────────────────────────────────────
function FieldRow({
  meta,
  value,
  onChange,
}: {
  meta: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const desc = FIELD_DESCRIPTORS[meta.key];
  const isDefault = JSON.stringify(value) === JSON.stringify((DEFAULTS as Record<string, unknown>)[meta.key]);
  return (
    <div className="py-3 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-[var(--text-primary)] font-medium">{meta.label}</span>
        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{meta.key}</span>
        {isDefault && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-1.5"
            data-testid={`blackhole-default-badge-${meta.key}`}
          >
            default
          </span>
        )}
      </div>
      <p className="text-[11.5px] text-[var(--text-tertiary)] mt-1.5 mb-0">{meta.help}</p>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <FieldControl desc={desc} meta={meta} value={value} onChange={onChange} />
        {meta.unit && <span className="text-[11px] text-[var(--text-tertiary)]">{meta.unit}</span>}
      </div>
    </div>
  );
}

const controlCls =
  "font-mono text-[12.5px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--accent-primary)]";

function FieldControl({
  desc,
  meta,
  value,
  onChange,
}: {
  desc: (typeof FIELD_DESCRIPTORS)[keyof BlackholeConfig];
  meta: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const testId = `blackhole-input-${meta.key}`;
  switch (desc.kind) {
    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            aria-label={meta.label}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={testId}
          />
          <span className="text-[12px] text-[var(--text-secondary)]">{value ? "On" : "Off"}</span>
        </label>
      );
    case "enum":
      return (
        <select
          className={`${controlCls} max-w-[340px]`}
          value={typeof value === "string" ? value : ""}
          aria-label={meta.label}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        >
          {desc.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    case "fraction":
      return (
        <input
          type="number"
          step="0.05"
          className={`${controlCls} w-[150px]`}
          value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
          aria-label={meta.label}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          data-testid={testId}
        />
      );
    default:
      return (
        <input
          type="number"
          className={`${controlCls} w-[150px]`}
          value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
          aria-label={meta.label}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          data-testid={testId}
        />
      );
  }
}
