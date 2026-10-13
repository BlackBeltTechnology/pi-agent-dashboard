/**
 * ContextModeSettingsForm — the real settings form (lazy-loaded by the
 * `ContextModeSettings` wrapper so it stays out of the cold index chunk).
 *
 * Grouped accordion over the descriptor table; each field shows its effective
 * value, a DEFAULT badge when unset, a per-field reset and inline validation.
 * Edits register with the host's unified Save Bar via `useSettingsDraftSource`.
 * Fields, groups and notices come from the shared settings field family in
 * `dashboard-plugin-runtime`; nothing here paints with an `--accent-*` text colour.
 *
 * See change: add-context-mode-settings-plugin, retro-ux-plugin-settings-forms.
 */
import {
  NumberField,
  SettingsGroup,
  SettingsNotice,
  TextField,
  ToggleField,
  useSettingsDraftSource,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
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
  const changedCount = useMemo(
    () => [...new Set([...Object.keys(payload), ...Object.keys(base)])].filter((k) => !same(payload[k], base[k])).length,
    [payload, base],
  );

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
      <SettingsNotice tone="error" testId="cms-load-error">
        {t("loadError", { error: loadError }, `Failed to load settings: ${loadError}`)}
      </SettingsNotice>
    );
  }
  if (!effective) {
    return (
      <div data-testid="cms-loading" className="text-sm text-[var(--text-secondary)]">
        {t("loading", undefined, "Loading…")}
      </div>
    );
  }

  return (
    <div data-testid="cms-root" className="text-sm text-[var(--text-secondary)]">
      <p className="mb-2 text-xs">
        {t("intro", undefined, "Tuning for the")} <code className="font-mono text-[12px]">context-mode</code>{" "}
        {t("introTail", undefined, "extension. Fields left at their default use context-mode's built-in value.")}
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span>{t("file", undefined, "File:")}</span>
        <span
          className="rounded border border-[var(--border-secondary)] px-1.5 font-mono text-[12px] text-[var(--text-primary)]"
          data-testid="cms-file-path"
        >
          {effective.filePath}
        </span>
        <span>· {effective.exists ? t("exists", undefined, "exists") : t("notCreated", undefined, "not yet created")}</span>
      </div>
      <SettingsNotice tone="info" testId="cms-notice-new-sessions" className="mb-2">
        {t("newSessionsNotice", undefined, "Changes apply to newly started sessions only; running sessions keep their current settings.")}
      </SettingsNotice>
      <SettingsNotice tone="info" testId="cms-notice-precedence" className="mb-4">
        {t(
          "precedenceNotice",
          undefined,
          "A variable already exported in the session's environment takes precedence over these settings (except a value that exists only in a tmux server's global environment).",
        )}
      </SettingsNotice>

      {SETTING_GROUPS.map((group) => {
        const fields = CONTEXT_SETTINGS.filter((d) => d.group === group);
        if (fields.length === 0) return null;
        return (
          <SettingsGroup
            key={group}
            title={t(`group_${group}`, undefined, GROUP_TITLES[group])}
            meta={`${fields.length} ${t("fields", undefined, "fields")}`}
          >
            {group === "storage" && (
              <SettingsNotice tone="info" testId="cms-notice-storage">
                {t(
                  "storageNotice",
                  undefined,
                  "Storage settings apply to sessions started from the dashboard only. For a terminal-launched pi, export the variable in your shell.",
                )}
              </SettingsNotice>
            )}
            {fields.map((d) => (
              <Field
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
          </SettingsGroup>
        );
      })}

      <div className="flex flex-wrap items-center gap-2.5">
        {isDirty ? (
          <span
            role="status"
            className="inline-flex items-center rounded-full border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-1.5 py-px text-[11px] font-semibold text-[var(--severity-warning-fg)]"
          >
            {changedCount === 1
              ? t("unsavedOne", undefined, "1 unsaved change")
              : t("unsavedMany", { count: changedCount }, `${changedCount} unsaved changes`)}
          </span>
        ) : (
          <span role="status" className="text-xs text-[var(--text-secondary)]">
            {t("noChanges", undefined, "No changes")}
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          className="focus-ring min-h-[44px] rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 text-xs text-[var(--text-primary)] sm:min-h-[36px]"
          onClick={() => setShowRaw((v) => !v)}
        >
          {t("viewRawJson", undefined, "View raw JSON")}
        </button>
      </div>
      {showRaw && (
        <pre
          className="mt-2 max-h-[52vh] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-code)] p-3 font-mono text-[12px] text-[var(--text-secondary)]"
          data-testid="cms-raw-json"
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Field({
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
  const shared = {
    label: d.label,
    keyLabel: d.key,
    hint: d.help,
    error: error ? t(`err_${error}`, undefined, error.replace(/_/g, " ")) : null,
    // The DEFAULT badge exists only while the value is unset; an override shows the reset control instead.
    state: isOverridden ? undefined : ("default" as const),
    stateLabel: t("defaultBadge", undefined, "default"),
    onReset: isOverridden ? onReset : undefined,
    resetLabel: t("reset", undefined, "Reset"),
    testIds: { control: id, state: `cms-default-badge-${d.key}`, reset: `cms-reset-${d.key}`, error: `cms-error-${d.key}` },
  };
  if (d.kind === "boolean") {
    return (
      <ToggleField
        {...shared}
        value={value === true}
        onChange={onChange}
        onLabel={t("on", undefined, "On")}
        offLabel={t("off", undefined, "Off")}
      />
    );
  }
  if (d.kind === "positiveNumber" || d.kind === "positiveInteger") {
    return (
      <NumberField
        {...shared}
        value={typeof value === "number" ? value : Number.NaN}
        onChange={onChange}
        decimal={d.kind === "positiveNumber"}
        allowEmpty
        step={d.kind === "positiveNumber" ? "any" : 1}
      />
    );
  }
  return (
    <TextField
      {...shared}
      mono
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
    />
  );
}
