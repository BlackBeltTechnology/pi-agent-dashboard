/**
 * ContextModeSettingsForm — the real settings form (lazy-loaded by the
 * `ContextModeSettings` wrapper so it stays out of the cold index chunk).
 *
 * Grouped accordion over the descriptor table; each field shows its effective
 * value, a DEFAULT badge when unset, a per-field reset and inline validation.
 * Edits register with the host's unified Save Bar via `useSettingsDraftSource`.
 *
 * See change: add-context-mode-settings-plugin.
 */
import { useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTEXT_SETTINGS,
  SETTING_GROUPS,
  type SettingDescriptor,
  validateValue,
} from "../shared/settings-descriptors.js";
import { type EffectiveSettings, getSettings, putSettings } from "./context-api.js";

const GROUP_TITLES: Record<string, string> = {
  storage: "Storage",
  search: "Search throttling",
  locale: "Locale",
  stats: "Stats",
  network: "Network",
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function buildPayload(values: Record<string, unknown>, overridden: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of CONTEXT_SETTINGS) {
    if (overridden.has(d.key) && values[d.key] !== undefined) out[d.key] = values[d.key];
  }
  return out;
}

export function ContextModeSettingsForm(): React.ReactElement {
  const t = useT();
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [base, setBase] = useState<Record<string, unknown>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const cfg = await getSettings("", signal);
      const v: Record<string, unknown> = {};
      const ov = new Set<string>();
      for (const d of CONTEXT_SETTINGS) {
        const fv = cfg.fields[d.key];
        v[d.key] = fv?.value;
        if (fv && !fv.isDefault) ov.add(d.key);
      }
      setValues(v);
      setOverridden(ov);
      setBase(buildPayload(v, ov));
      setEffective(cfg);
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
    setValues((p) => ({ ...p, [key]: value }));
    setOverridden((p) => (p.has(key) ? p : new Set(p).add(key)));
  }, []);

  const resetField = useCallback((key: string) => {
    const d = CONTEXT_SETTINGS.find((x) => x.key === key);
    setValues((p) => ({ ...p, [key]: d?.default }));
    setOverridden((p) => {
      const n = new Set(p);
      n.delete(key);
      return n;
    });
  }, []);

  const payload = useMemo(() => buildPayload(values, overridden), [values, overridden]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of CONTEXT_SETTINGS) {
      if (!overridden.has(d.key)) continue;
      const e = validateValue(d, values[d.key]);
      if (e) out[d.key] = e;
    }
    return out;
  }, [values, overridden]);
  const isDirty = !same(payload, base);

  useSettingsDraftSource({
    id: "plugin:context-mode-settings",
    isDirty,
    commit: async () => {
      if (Object.keys(errors).length > 0) {
        throw new Error(t("fixInvalidFields", undefined, "Fix the invalid fields before saving."));
      }
      await putSettings(payload);
      await load();
    },
    reset: () => {
      void load();
    },
  });

  if (loadError) {
    return (
      <div className="text-[13px] text-[var(--accent-red)]" data-testid="cms-load-error">
        {t("loadError", { error: loadError }, `Failed to load settings: ${loadError}`)}
      </div>
    );
  }
  if (!effective) {
    return <div className="text-[13px] text-[var(--text-muted)]">{t("loading", undefined, "Loading…")}</div>;
  }

  const notice = "flex gap-2 items-start text-[12px] rounded-lg px-2.5 py-2 mb-2 border";
  const noticeStyle = {
    background: "color-mix(in srgb, var(--accent-yellow) 12%, transparent)",
    borderColor: "color-mix(in srgb, var(--accent-yellow) 40%, transparent)",
  };

  return (
    <div className="text-[13px] text-[var(--text-secondary)]">
      <p className="text-[12px] mb-2">
        {t("intro", undefined, "Tuning for the")} <code className="font-mono text-[11px]">context-mode</code>{" "}
        {t("introTail", undefined, "extension. Fields left at their default use context-mode's built-in value.")}
      </p>
      <div className="font-mono text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5 mb-3">
        <span>{t("file", undefined, "File:")}</span>
        <span className="border border-[var(--border-secondary)] rounded px-1.5" data-testid="cms-file-path">
          {effective.filePath}
        </span>
        <span>· {effective.exists ? t("exists", undefined, "exists") : t("notCreated", undefined, "not yet created")}</span>
      </div>
      <div className={notice} style={noticeStyle} data-testid="cms-notice-new-sessions">
        {t("newSessionsNotice", undefined, "Changes apply to newly started sessions only; running sessions keep their current settings.")}
      </div>
      <div className={`${notice} mb-4`} style={noticeStyle} data-testid="cms-notice-precedence">
        {t(
          "precedenceNotice",
          undefined,
          "A variable already exported in the session's environment takes precedence over these settings (except a value that exists only in a tmux server's global environment).",
        )}
      </div>

      {SETTING_GROUPS.map((group) => {
        const fields = CONTEXT_SETTINGS.filter((d) => d.group === group);
        if (fields.length === 0) return null;
        return (
          <details
            key={group}
            className="border border-[var(--border-secondary)] rounded-[10px] overflow-hidden mb-2.5 bg-[var(--bg-secondary)]"
            open
          >
            <summary className="cursor-pointer flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] select-none list-none">
              {t(`group_${group}`, undefined, GROUP_TITLES[group])}
              <span className="ml-auto text-[11px] text-[var(--text-tertiary)] font-medium">
                {fields.length} {t("fields", undefined, "fields")}
              </span>
            </summary>
            <div className="px-3.5 pb-3 pt-1 border-t border-[var(--border-subtle)]">
              {group === "storage" && (
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-2 mb-0" data-testid="cms-notice-storage">
                  {t(
                    "storageNotice",
                    undefined,
                    "Storage settings apply to sessions started from the dashboard only. For a terminal-launched pi, export the variable in your shell.",
                  )}
                </p>
              )}
              {fields.map((d) => (
                <FieldRow
                  key={d.key}
                  d={d}
                  value={values[d.key]}
                  isOverridden={overridden.has(d.key)}
                  error={errors[d.key] ?? null}
                  onChange={(v) => setField(d.key, v)}
                  onReset={() => resetField(d.key)}
                  t={t}
                />
              ))}
            </div>
          </details>
        );
      })}

      <div className="flex items-center gap-2.5">
        <span className={`text-[12px] ${isDirty ? "text-[var(--accent-yellow)]" : "text-[var(--text-tertiary)]"}`}>
          {isDirty ? t("unsaved", undefined, "Unsaved changes") : t("noChanges", undefined, "No changes")}
        </span>
        <span className="ml-auto" />
        <button
          type="button"
          className="text-[12.5px] px-3.5 py-1.5 rounded-md bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          onClick={() => setShowRaw((v) => !v)}
        >
          {t("viewRawJson", undefined, "View raw JSON")}
        </button>
      </div>
      {showRaw && (
        <pre
          className="mt-2 font-mono text-[11.5px] text-[var(--text-secondary)] bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded-lg p-3 max-h-[52vh] overflow-auto"
          data-testid="cms-raw-json"
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

const inputCls =
  "font-mono text-[12.5px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--accent-primary)]";

function FieldRow({
  d,
  value,
  isOverridden,
  error,
  onChange,
  onReset,
  t,
}: {
  d: SettingDescriptor;
  value: unknown;
  isOverridden: boolean;
  error: string | null;
  onChange: (v: unknown) => void;
  onReset: () => void;
  t: ReturnType<typeof useT>;
}): React.ReactElement {
  const id = `cms-input-${d.key}`;
  return (
    <div className="py-3 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="text-[13px] text-[var(--text-primary)] font-medium">
          {d.label}
        </label>
        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{d.key}</span>
        {!isOverridden && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-1.5"
            data-testid={`cms-default-badge-${d.key}`}
          >
            {t("defaultBadge", undefined, "default")}
          </span>
        )}
        {isOverridden && (
          <button
            type="button"
            className="ml-auto text-[11px] text-[var(--accent-blue)]"
            onClick={onReset}
            data-testid={`cms-reset-${d.key}`}
          >
            {t("reset", undefined, "Reset")}
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-[var(--text-tertiary)] mt-1.5 mb-0">{d.help}</p>
      <div className="mt-2">
        <FieldControl d={d} id={id} value={value} error={error} onChange={onChange} />
      </div>
      {error && (
        <p className="text-[11px] text-[var(--accent-red)] mt-1 mb-0" role="alert" data-testid={`cms-error-${d.key}`}>
          {t(`err_${error}`, undefined, error.replace(/_/g, " "))}
        </p>
      )}
    </div>
  );
}

function FieldControl({
  d,
  id,
  value,
  error,
  onChange,
}: {
  d: SettingDescriptor;
  id: string;
  value: unknown;
  error: string | null;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  if (d.kind === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
        <span className="text-[12px]">{value ? "On" : "Off"}</span>
      </label>
    );
  }
  if (d.kind === "positiveNumber" || d.kind === "positiveInteger") {
    return (
      <input
        id={id}
        type="number"
        className={`${inputCls} w-[170px]`}
        aria-invalid={error ? true : undefined}
        value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        data-testid={id}
      />
    );
  }
  return (
    <input
      id={id}
      type="text"
      className={`${inputCls} w-full max-w-[340px]`}
      aria-invalid={error ? true : undefined}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      data-testid={id}
    />
  );
}
