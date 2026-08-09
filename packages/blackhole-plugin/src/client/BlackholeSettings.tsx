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
import { useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BlackholeConfig,
  DEFAULTS,
  FIELD_DESCRIPTORS,
  KNOWN_KEYS,
  type ModelRef,
} from "../shared/blackhole-config.js";
import { normalizeModel, readChain, writeChain } from "../shared/chain-model.js";
import { type ConfigOk, type ConfigResult, getConfig, isExtensionInstalled, putConfig } from "./blackhole-api.js";
import { ChainEditor } from "./ChainEditor.js";
import { FIELD_GROUPS, type FieldMeta, WORKER_META } from "./field-groups.js";

const INSTALL_COMMAND = "pi install npm:pi-blackhole";

/** Keys rendered by the chain editors rather than as scalar fields. */
const CHAIN_KEYS = new Set<string>([
  "model",
  ...WORKER_META.flatMap((w) => [w.primaryKey, w.fallbackKey]),
]);

type Chains = Record<string, ModelRef[]>;

interface Draft {
  values: Record<string, unknown>;
  chains: Chains;
  baseModel: ModelRef | null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Build the editable draft from a GET result. */
function toDraft(cfg: ConfigOk): Draft {
  const values: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) values[key] = cfg.fields[key]?.value;
  const chains: Chains = {};
  for (const w of WORKER_META) chains[w.worker] = readChain(values, w.primaryKey, w.fallbackKey);
  const base = values.model;
  return {
    values,
    chains,
    baseModel: base && typeof base === "object" && !Array.isArray(base) ? (base as ModelRef) : null,
  };
}

/**
 * Build the PUT body: every managed scalar's effective value, plus each chain
 * split back into its `<worker>Model` / `<worker>FallbackModels` pair. `null`
 * explicitly unsets a model key — `undefined` would be dropped by
 * `JSON.stringify` and the key would silently survive on disk.
 */
export function buildPayload(draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    if (CHAIN_KEYS.has(key)) continue;
    const value = draft.values[key];
    // `undefined` = the key has no default and was never set; `NaN` = a cleared
    // numeric input, which is not an edit instruction the config can express.
    // Both mean "say nothing about this key", so the on-disk value stands.
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isNaN(value)) continue;
    out[key] = value;
  }
  out.model = draft.baseModel ? normalizeModel(draft.baseModel as unknown as Record<string, unknown>) : null;
  for (const w of WORKER_META) {
    const { primary, fallbacks } = writeChain(draft.chains[w.worker] ?? []);
    out[w.primaryKey] = primary ?? null;
    out[w.fallbackKey] = fallbacks ?? null;
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

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const present = await isExtensionInstalled("", signal);
      setInstalled(present);
      if (!present) {
        setResult(null);
        setDraft(null);
        return;
      }
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
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

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
      await putConfig(payload);
      await load();
    },
    reset: () => {
      void load();
    },
  });

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

      <details
        open
        className="border border-[var(--border-secondary)] rounded-[10px] overflow-hidden mb-2.5 bg-[var(--bg-secondary)]"
        data-testid="blackhole-group-chains"
      >
        <summary className="cursor-pointer flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] select-none list-none">
          {t("workerModels", undefined, "Worker models")}
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
          {WORKER_META.map((w) => (
            <ChainEditor
              key={w.worker}
              worker={w.worker}
              name={w.name}
              role={w.role}
              entries={draft.chains[w.worker] ?? []}
              onChange={(next) => setChain(w.worker, next)}
              baseModel={draft.baseModel}
              sessionFallback={sessionFallback}
            />
          ))}
        </div>
      </details>
    </div>
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
