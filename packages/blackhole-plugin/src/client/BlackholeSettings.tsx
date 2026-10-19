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
 * Presentation is the shared settings field kit (`SettingsGroup`, `NumberField`,
 * `SelectField`, `ToggleField`, `SettingsNotice`): errors are one human sentence
 * with the raw text (parser message, HTTP status, server body) behind "Copy
 * details", never rendered. Retry/recheck/copy controls sit inside the notice,
 * never inside a `<summary>`.
 *
 * See changes: add-blackhole-plugin, retro-ux-plugin-settings-wave-2.
 */
import {
  FieldShell,
  NumberField,
  SelectField,
  SettingsCopyButton,
  SettingsGroup,
  SettingsNotice,
  SettingsStatusPill,
  ToggleField,
  useSettingsDraftSource,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  type BlackholeConfig,
  DEFAULTS,
  type FieldDescriptor,
  FIELD_DESCRIPTORS,
  KNOWN_KEYS,
  type ModelRef,
} from "../shared/blackhole-config.js";
import { readChain, recommendedDefaults, toWire, writeChain } from "../shared/chain-model.js";
import {
  type ConfigOk,
  type ConfigResult,
  getConfig,
  getModels,
  isExtensionInstalled,
  putConfig,
  reattachBinding,
} from "./blackhole-api.js";
import { ChainEditor, type RegistryState } from "./ChainEditor.js";
import { FIELD_GROUPS, type FieldMeta, WORKER_META } from "./field-groups.js";
import { BTN_GHOST, BTN_SECONDARY } from "./settings-buttons.js";

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

/**
 * Human sentence for an invalid scalar, or `null`. `undefined` means the key has no
 * default and was never set (inherit), which is valid; `NaN` is a cleared input.
 */
function fieldError(
  desc: FieldDescriptor,
  value: unknown,
  t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string,
): string | null {
  if (value === undefined) return null;
  if (desc.kind === "integer") {
    if (typeof value === "number" && Number.isInteger(value) && value >= desc.min) return null;
    return t("intError", { min: desc.min }, `Enter a whole number of ${desc.min} or more.`);
  }
  if (desc.kind === "fraction") {
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1) return null;
    return t("fractionError", undefined, "Enter a number above 0, up to 1.");
  }
  return null;
}

/** Wrap slash commands and `_comment` in `<code>`; the catalogue stays plain text. */
function renderHelp(text: string): ReactNode {
  const parts = text.split(/((?<![A-Za-z])\/[a-z]+|_comment)/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of a constant string
      <code key={i} className="font-mono text-[12px]">
        {part}
      </code>
    ) : (
      part
    ),
  );
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
  const bindings = new Map((cfg.roleBindings ?? []).map((b) => [b.field, b]));
  const mark = (entry: ModelRef, field: string): ModelRef => {
    const b = bindings.get(field);
    return b ? { ...entry, role: b.ref, roleStatus: b.status } : entry;
  };
  const chains: Chains = {};
  for (const w of WORKER_META) {
    chains[w.worker] = readChain(values, w.primaryKey, w.fallbackKey).map((e, i) =>
      mark(e, i === 0 ? w.primaryKey : `${w.fallbackKey}[${i - 1}]`),
    );
  }
  const base = values.model;
  return {
    values,
    chains,
    baseModel:
      base && typeof base === "object" && !Array.isArray(base) ? mark(base as ModelRef, "model") : null,
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

/** The entry without its UI-only role markers — the shape the file holds. */
function bare(entry: ModelRef): ModelRef {
  const { role: _role, roleStatus: _status, ...rest } = entry;
  return rest;
}

/**
 * A role-bound key the user has not changed since load. Re-sending it would
 * re-resolve the role on an unrelated save: a `dangling` binding would 400 the
 * whole PUT, and a `detached` slot's external edit would be overwritten.
 */
function boundUntouched(bound: boolean, current: unknown, loaded: unknown): boolean {
  return bound && same(current, loaded);
}

/** The base model plus each worker chain, split back into its key pair. */
function modelPayload(draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (
    shouldEmit(draft, "model", draft.baseModel) &&
    !boundUntouched(
      draft.baseModel?.role !== undefined,
      draft.baseModel ? bare(draft.baseModel) : null,
      draft.loaded.model,
    )
  ) {
    out.model = draft.baseModel ? toWire(draft.baseModel) : null;
  }
  for (const w of WORKER_META) {
    const { primary, fallbacks } = writeChain(draft.chains[w.worker] ?? []);
    if (
      shouldEmit(draft, w.primaryKey, primary ?? null) &&
      !boundUntouched(primary?.role !== undefined, primary ? bare(primary) : null, draft.loaded[w.primaryKey])
    ) {
      out[w.primaryKey] = primary ? toWire(primary) : null;
    }
    if (
      shouldEmit(draft, w.fallbackKey, fallbacks ?? null) &&
      !boundUntouched(
        (fallbacks ?? []).some((e) => e.role !== undefined),
        fallbacks ? fallbacks.map(bare) : null,
        draft.loaded[w.fallbackKey],
      )
    ) {
      out[w.fallbackKey] = fallbacks ? fallbacks.map(toWire) : null;
    }
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

  const reattach = useCallback(
    async (field: string) => {
      try {
        setSaveError(null);
        await reattachBinding(field);
        await load();
      } catch (err) {
        setSaveError(errMsg(err));
      }
    },
    [load],
  );

  const setChain = useCallback((worker: string, next: ModelRef[]) => {
    setDraft((prev) => (prev ? { ...prev, chains: { ...prev.chains, [worker]: next } } : prev));
  }, []);

  const payload = useMemo(() => (draft ? buildPayload(draft) : null), [draft]);
  const isDirty = payload !== null && JSON.stringify(payload) !== baseline;
  const fieldErrors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!draft) return out;
    for (const group of FIELD_GROUPS) {
      for (const meta of group.fields) {
        const e = fieldError(FIELD_DESCRIPTORS[meta.key], draft.values[meta.key], t);
        if (e) out[meta.key] = e;
      }
    }
    return out;
  }, [draft, t]);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  useSettingsDraftSource({
    id: "plugin:blackhole",
    isDirty,
    commit: async () => {
      if (!payload) return;
      if (hasFieldErrors) throw new Error(t("fixInvalid", undefined, "Fix the invalid fields before saving."));
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
      <SettingsNotice
        tone="error"
        testId="blackhole-load-error"
        onRetry={() => void load()}
        details={loadError}
      >
        {t("loadError", undefined, "Could not load the blackhole settings. The dashboard server did not answer.")}
      </SettingsNotice>
    );
  }

  if (installed === false) {
    return (
      <SettingsNotice
        tone="info"
        testId="blackhole-not-installed"
        actions={<SettingsCopyButton text={INSTALL_COMMAND} label={t("copyCommand", undefined, "Copy command")} />}
      >
        <strong className="block">{t("notInstalledTitle", undefined, "pi-blackhole isn't installed")}</strong>
        <span className="block">
          {t(
            "notInstalledBody",
            undefined,
            "This page configures the pi-blackhole extension — unified algorithmic compaction plus observational memory. Install it in any pi session, then reload.",
          )}
        </span>
        <code className="mt-1 inline-block font-mono text-[12px]" data-testid="blackhole-install-command">
          {INSTALL_COMMAND}
        </code>
      </SettingsNotice>
    );
  }

  if (installed === null || (result === null && !loadError)) {
    return <div className="text-xs text-[var(--text-secondary)]">{t("loading", undefined, "Loading…")}</div>;
  }

  if (result?.status === "parse-error") {
    return (
      <div className="space-y-3" data-testid="blackhole-parse-root">
        <FilePath path={result.filePath} />
        <SettingsNotice
          tone="error"
          testId="blackhole-parse-error"
          details={result.message}
          actions={
            <>
              <button type="button" className={BTN_SECONDARY} data-testid="blackhole-recheck" onClick={() => void load()}>
                <Icon path={mdiRefresh} size={0.55} aria-hidden="true" />
                {t("recheck", undefined, "Check again")}
              </button>
              <button type="button" disabled className={BTN_GHOST} data-testid="blackhole-save-blocked">
                {t("saveBlocked", undefined, "Save")}
              </button>
            </>
          }
        >
          <strong className="block" data-testid="blackhole-parse-message">
            {t("parseErrorTitle", undefined, "The config file can't be read, so editing is off.")}
          </strong>
          <span className="block">
            {t(
              "parseErrorBody",
              undefined,
              "Fix the file by hand, then check again. Blackhole keeps all its settings in this one file, so there are no values to show.",
            )}
          </span>
        </SettingsNotice>
      </div>
    );
  }

  if (!draft || result?.status !== "ok") {
    return <div className="text-xs text-[var(--text-secondary)]">{t("loading", undefined, "Loading…")}</div>;
  }

  const sessionFallback = draft.values.sessionFallback !== false;

  return (
    <div className="space-y-3" data-testid="blackhole-settings">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("intro", undefined, "Compaction and observational memory for the")}{" "}
        <code className="font-mono text-[12px]">pi-blackhole</code> {t("introTail", undefined, "extension.")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <FilePath path={result.filePath} />
        <SettingsStatusPill tone="neutral" icon={null}>
          {result.exists
            ? t("nUnmanaged", { count: result.unmanagedKeys.length }, `${result.unmanagedKeys.length} unmanaged keys preserved`)
            : t("notCreated", undefined, "not yet created")}
        </SettingsStatusPill>
      </div>

      {/* Apply semantics: attributed to the extension, never phrased as a
          dashboard guarantee, and never demanding a restart. */}
      <SettingsNotice tone="info" testId="blackhole-apply-note">
        {t(
          "applyNote",
          undefined,
          "pi-blackhole re-reads this file after every write, so saved changes reach running sessions on its own. Keys this page doesn't manage (including _comment notes) are preserved untouched.",
        )}
      </SettingsNotice>

      <div>
        {FIELD_GROUPS.map((group) => (
          <SettingsGroup
            key={group.title}
            title={group.title}
            meta={`${group.fields.length} ${t("fields", undefined, "fields")}`}
            defaultOpen={false}
            testId={`blackhole-group-${group.title}`}
          >
            {group.fields.map((meta) => (
              <FieldRow
                key={meta.key}
                meta={meta}
                value={draft.values[meta.key]}
                error={fieldErrors[meta.key] ?? null}
                onChange={(v) => setField(meta.key, v)}
              />
            ))}
          </SettingsGroup>
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
          onSetBaseModel={(base) => setDraft((prev) => (prev ? { ...prev, baseModel: base } : prev))}
          onDefaultsClick={handleDefaultsClick}
          onSetChain={setChain}
          onReattach={reattach}
        />
      </div>
    </div>
  );
}

/** The config file path as a neutral mono chip (no accent colour). */
function FilePath({ path }: { path: string }): React.ReactElement {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
      <span>{t("file", undefined, "File:")}</span>
      <code
        className="break-all rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 font-mono text-[12px] text-[var(--text-primary)]"
        data-testid="blackhole-file-path"
      >
        {path}
      </code>
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
  /** Re-project the role into a detached slot (`field` is the binding key). */
  onReattach: (field: string) => void;
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
  onReattach,
}: ChainsSectionProps): React.ReactElement {
  const t = useT();
  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  return (
    <SettingsGroup
      title={t("workerModels", undefined, "Worker models")}
      meta={`${WORKER_META.length} ${t("chains", undefined, "chains")}`}
      testId="blackhole-group-chains"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="m-0 min-w-0 flex-1 text-xs text-[var(--text-secondary)]">
          {t(
            "chainsHelp",
            undefined,
            "Each worker tries its models top to bottom. A model that returns a retryable error is skipped for its cooldown window, and the next one runs.",
          )}
        </p>
        <button
          type="button"
          data-testid="blackhole-registry-retry"
          className={BTN_SECONDARY}
          onClick={() => void onRetryRegistry()}
        >
          <Icon path={mdiRefresh} size={0.55} aria-hidden="true" />
          {t("refreshModels", undefined, "Refresh models")}
        </button>
      </div>

      {saveError && (
        <SettingsNotice tone="error" testId="blackhole-save-error" details={saveError}>
          {t("saveFailed", undefined, "Could not save the blackhole settings. Check the values, then try again.")}
        </SettingsNotice>
      )}

      {registryState === "unavailable" && (
        <SettingsNotice
          tone="error"
          testId="blackhole-registry-unavailable"
          details={registryReason}
          actions={
            <button
              type="button"
              data-testid="blackhole-registry-retry-banner"
              className={BTN_SECONDARY}
              onClick={() => void onRetryRegistry()}
            >
              <Icon path={mdiRefresh} size={0.55} aria-hidden="true" />
              {t("retryRegistry", undefined, "Retry")}
            </button>
          }
        >
          {t("registryUnavailable", undefined, "Could not load the model list. Model pickers are read-only until it loads.")}
        </SettingsNotice>
      )}

      {registryState === "empty" && (
        <SettingsNotice tone="warning" testId="blackhole-registry-empty">
          {t(
            "registryEmpty",
            undefined,
            "No credentialed models in registry. Configure provider API keys in Settings > Providers to enable model selection.",
          )}
        </SettingsNotice>
      )}

      {/* Base Model picker row (design D7) */}
      <div data-testid="blackhole-base-model-card">
        <FieldShell
          label={t("baseModelLabel", undefined, "Base model")}
          stacked
          keyLabel="model"
          hint={t("baseModelHelp", undefined, "Shared fallback for all workers before the session model.")}
          state={draft.baseModel === null ? "default" : "changed"}
          control={({ id, describedBy }) => (
            <div
              id={id}
              role="group"
              aria-label={t("baseModelLabel", undefined, "Base model")}
              aria-describedby={describedBy}
              className="flex flex-wrap items-center gap-2"
            >
              {registryState === "ok" ? (
                <ModelSelectorPrimitive
                  current={
                    draft.baseModel?.role ??
                    (draft.baseModel ? `${draft.baseModel.provider}/${draft.baseModel.id}` : undefined)
                  }
                  models={models}
                  allowRoles
                  placeholder={t("selectBaseModelPlaceholder", undefined, "Select base model…")}
                  onSelect={(label: string) => {
                    if (label.startsWith("@")) {
                      onSetBaseModel({ provider: draft.baseModel?.provider ?? "", id: draft.baseModel?.id ?? "", role: label });
                      return;
                    }
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
                <code data-testid="blackhole-base-model-value" className="font-mono text-[12px] text-[var(--text-primary)]">
                  {draft.baseModel ? `${draft.baseModel.provider}/${draft.baseModel.id}` : "—"}
                </code>
              )}
              <button
                type="button"
                data-testid="blackhole-base-model-clear"
                disabled={draft.baseModel === null}
                onClick={() => onSetBaseModel(null)}
                className={BTN_SECONDARY}
              >
                {t("clearBaseModel", undefined, "Clear")}
              </button>
            </div>
          )}
        />
      </div>

      {/* Recommended Defaults Action (design D6) */}
      <SettingsNotice
        tone="info"
        testId="blackhole-recommended-defaults-card"
        actions={
          <button
            type="button"
            disabled={!hasCandidate}
            data-testid="blackhole-recommended-defaults-btn"
            onClick={onDefaultsClick}
            className={BTN_SECONDARY}
          >
            {t("recommendedDefaultsLabel", undefined, "Use recommended defaults")}
          </button>
        }
      >
        <p className="m-0">
          {t(
            "recommendedDefaultsHelp",
            undefined,
            "Recommended defaults stages resilient flash-class chains (up to 3 models across distinct providers) for observer, reflector, and dropper, plus debug logging.",
          )}
        </p>
        {registryState !== "ok" && (
          <p className="m-0 mt-1">
            {t("recommendedDefaultsDisabledUnavailable", undefined, "Registry unavailable. Staging defaults is disabled.")}
          </p>
        )}
        {registryState === "ok" && !hasCandidate && (
          <p className="m-0 mt-1">
            {t("recommendedDefaultsNoCandidate", undefined, "No flash, haiku, or mini models found in registry.")}
          </p>
        )}
        {stagedDefaultsCount !== null && (
          <p className="m-0 mt-1 font-semibold">
            {t(
              "recommendedDefaultsFewerThan3",
              { count: stagedDefaultsCount },
              `Staged ${stagedDefaultsCount} of 3 recommended models from available candidates.`,
            )}
          </p>
        )}
      </SettingsNotice>

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
          onReattach={(index) => onReattach(index === 0 ? w.primaryKey : `${w.fallbackKey}[${index - 1}]`)}
        />
      ))}
    </SettingsGroup>
  );
}

// ── One scalar field row ─────────────────────────────────────────
function FieldRow({
  meta,
  value,
  error,
  onChange,
}: {
  meta: FieldMeta;
  value: unknown;
  error: string | null;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const desc = FIELD_DESCRIPTORS[meta.key];
  const def = (DEFAULTS as Record<string, unknown>)[meta.key];
  const isDefault = JSON.stringify(value) === JSON.stringify(def);
  const common = {
    label: meta.label,
    hint: renderHelp(meta.help),
    keyLabel: meta.key as string,
    unit: meta.unit,
    error,
    state: isDefault ? ("default" as const) : ("changed" as const),
    // Keys with no built-in default (inherit) have nothing to reset to.
    onReset: !isDefault && def !== undefined ? () => onChange(def) : undefined,
    testIds: {
      control: `blackhole-input-${meta.key}`,
      state: `blackhole-default-badge-${meta.key}`,
      reset: `blackhole-reset-${meta.key}`,
      error: `blackhole-error-${meta.key}`,
    },
  };
  switch (desc.kind) {
    case "boolean":
      return <ToggleField {...common} value={value === true} onChange={onChange} />;
    case "enum":
      return (
        <SelectField
          {...common}
          value={typeof value === "string" ? value : ""}
          options={desc.values.map((v) => ({ value: v, label: v }))}
          onChange={onChange}
        />
      );
    case "fraction":
      return (
        <NumberField
          {...common}
          decimal
          allowEmpty
          step={0.05}
          value={typeof value === "number" ? value : Number.NaN}
          onChange={onChange}
        />
      );
    default:
      return (
        <NumberField
          {...common}
          allowEmpty
          value={typeof value === "number" ? value : Number.NaN}
          onChange={onChange}
        />
      );
  }
}
