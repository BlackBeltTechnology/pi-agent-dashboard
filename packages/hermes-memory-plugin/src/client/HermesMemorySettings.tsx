/**
 * HermesMemorySettings — settings-section slot (general tab).
 *
 * Full-coverage form over every `MemoryConfig` field, grouped into 9 collapsible
 * accordions (promoted from `mockups/hermes-settings.html`, design D8). Each
 * field shows its effective value; unset fields show the resolved default with a
 * DEFAULT badge + a per-field Reset. A sticky save bar reports the change count
 * and writes the full resolved config via PUT; a raw-JSON view + an "applies to
 * new sessions" notice complete the surface. Folds the UX-review deferrals:
 * inline number/regex validation (Save disabled while invalid), conditional
 * reveal of memoryPolicyCustomText, and a prefers-reduced-motion guard.
 *
 * See change: add-hermes-memory-settings-plugin.
 */
import { useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULTS, FIELD_DESCRIPTORS, KNOWN_KEYS, type MemoryConfig } from "../shared/hermes-config.js";
import { FIELD_GROUPS, type FieldMeta } from "./field-groups.js";
import { type EffectiveConfig, getConfig, putConfig } from "./hermes-api.js";
import { arrayToLines, buildResolvedConfig, fieldError, linesToArray, valueEquals } from "./settings-model.js";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function HermesMemorySettings(): React.ReactElement {
  const t = useT();
  const [effective, setEffective] = useState<EffectiveConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Editable state: current value per key + the set of user-overridden keys.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [baseValues, setBaseValues] = useState<Record<string, unknown>>({});
  const [baseOverridden, setBaseOverridden] = useState<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const cfg = await getConfig("", signal);
      const v: Record<string, unknown> = {};
      const ov = new Set<string>();
      for (const key of KNOWN_KEYS) {
        const fv = cfg.fields[key];
        v[key] = fv?.value;
        if (fv && !fv.isDefault) ov.add(key);
      }
      setValues(v);
      setOverridden(ov);
      setBaseValues({ ...v });
      setBaseOverridden(new Set(ov));
      setEffective(cfg);
      setSaveError(null);
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

  // Escape-to-close for the raw-JSON modal (keyboard dismissal).
  useEffect(() => {
    if (!showRaw) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowRaw(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showRaw]);

  const setField = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setOverridden((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const resetField = useCallback((key: string) => {
    setValues((prev) => ({ ...prev, [key]: (DEFAULTS as Record<string, unknown>)[key] }));
    setOverridden((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const isDirty = useCallback(
    (key: string): boolean => {
      const curOv = overridden.has(key);
      const baseOv = baseOverridden.has(key);
      if (curOv !== baseOv) return true;
      if (curOv) return !valueEquals(values[key], baseValues[key]);
      return false;
    },
    [overridden, baseOverridden, values, baseValues],
  );

  const changedCount = useMemo(() => KNOWN_KEYS.filter((k) => isDirty(k)).length, [isDirty]);
  const hasErrors = useMemo(
    () => KNOWN_KEYS.some((k) => overridden.has(k) && fieldError(k, values[k]) !== null),
    [overridden, values],
  );

  // Conditional reveal: memoryPolicyCustomText only when the effective
  // memoryPolicyStyle is "custom" (UX-review deferral 6.2).
  const effectiveStyle = overridden.has("memoryPolicyStyle")
    ? values.memoryPolicyStyle
    : DEFAULTS.memoryPolicyStyle;
  const showCustomText = effectiveStyle === "custom";

  // Register with the host's unified Save. The plugin no longer owns a save
  // affordance of its own — the global Save Bar commits these edits and files
  // them under `plugins/hermes-memory` (the host assigns the page id).
  // See change: plugin-settings-pages (design D5).
  useSettingsDraftSource({
    id: "plugin:hermes-memory",
    isDirty: changedCount > 0 && !hasErrors,
    commit: async () => {
      await putConfig(buildResolvedConfig(values, overridden));
      await load();
    },
    reset: () => {
      void load();
    },
  });

  if (loadError) {
    return (
      <div className="text-[13px] text-[var(--accent-red)]" data-testid="hermes-load-error">
        {t("loadError", { error: loadError }, `Failed to load config: ${loadError}`)}
      </div>
    );
  }
  if (!effective) {
    return <div className="text-[13px] text-[var(--text-muted)]">{t("loading", undefined, "Loading…")}</div>;
  }

  return (
    <div className="text-[13px] text-[var(--text-secondary)] pb-24">
      {/* prefers-reduced-motion guard (6.3) */}
      <style>{"@media (prefers-reduced-motion: reduce){.hm-motion{transition:none !important}}"}</style>

      <p className="text-[12px] text-[var(--text-secondary)] mb-2">
        {t("intro", undefined, "Configuration for the")}{" "}
        <code className="font-mono text-[11px]">pi-hermes-memory</code>{" "}
        {t("introTail", undefined, "extension. Fields left at their default track the extension's built-in value.")}
      </p>

      <div className="font-mono text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5 mb-3">
        <span>{t("file", undefined, "File:")}</span>
        <span className="border border-[var(--border-secondary)] rounded px-1.5 text-[var(--accent-green)]" data-testid="hermes-file-path">
          {effective.filePath}
        </span>
        <span>· {effective.exists ? t("exists", undefined, "exists") : t("notCreated", undefined, "not yet created")}</span>
      </div>

      <div
        className="flex gap-2 items-start text-[12px] rounded-lg px-2.5 py-2 mb-4 border"
        style={{
          background: "color-mix(in srgb, var(--accent-yellow) 12%, transparent)",
          borderColor: "color-mix(in srgb, var(--accent-yellow) 40%, transparent)",
        }}
      >
        <span>
          {t(
            "newSessionsNotice",
            undefined,
            "Changes apply to newly started sessions. Hermes reads its config once at extension load, so running sessions keep their current settings until restarted.",
          )}
        </span>
      </div>

      {FIELD_GROUPS.map((group) => {
        const groupDirty = group.fields.some((f) => isDirty(f.key));
        return (
          <details
            key={group.title}
            className="border border-[var(--border-secondary)] rounded-[10px] overflow-hidden mb-2.5 bg-[var(--bg-secondary)]"
          >
            <summary className="cursor-pointer flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] select-none list-none">
              <span className="hm-motion text-[var(--text-tertiary)]">▸</span>
              {group.title}
              {groupDirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />}
              <span className="ml-auto text-[11px] text-[var(--text-tertiary)] font-medium">
                {group.fields.length} {t("fields", undefined, "fields")}
              </span>
            </summary>
            <div className="px-3.5 pb-3 pt-1 border-t border-[var(--border-subtle)]">
              {group.fields.map((meta) => {
                if (meta.key === "memoryPolicyCustomText" && !showCustomText) return null;
                return (
                  <FieldRow
                    key={meta.key}
                    meta={meta}
                    value={values[meta.key]}
                    isOverridden={overridden.has(meta.key)}
                    error={overridden.has(meta.key) ? fieldError(meta.key, values[meta.key]) : null}
                    onChange={(v) => setField(meta.key, v)}
                    onReset={() => resetField(meta.key)}
                    t={t}
                  />
                );
              })}
            </div>
          </details>
        );
      })}

      {/* No save footer: the host Settings panel owns Save/Discard through the
          global Save Bar, and a `position: fixed` bar here overlaid every
          settings page. See change: plugin-settings-pages (design D5). */}
      <div className="flex items-center gap-2.5">
        <span
          className={`text-[12px] ${changedCount ? "text-[var(--accent-yellow)]" : "text-[var(--text-tertiary)]"}`}
          data-testid="hermes-change-status"
        >
          {changedCount
            ? t("nChanged", { count: changedCount }, `${changedCount} field${changedCount > 1 ? "s" : ""} changed · not yet saved`)
            : t("noChanges", undefined, "No changes")}
        </span>
        {saveError && <span className="text-[12px] text-[var(--accent-red)]">{saveError}</span>}
        <span className="ml-auto" />
        <button
          type="button"
          className="text-[12.5px] px-3.5 py-1.5 rounded-md bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          onClick={() => setShowRaw(true)}
        >
          {t("viewRawJson", undefined, "View raw JSON")}
        </button>
      </div>

      {showRaw && (
        <div
          className="fixed inset-0 bg-black/55 flex items-center justify-center z-20"
          onClick={() => setShowRaw(false)}
          role="presentation"
        >
          <div
            className="max-w-[640px] w-[92vw] bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)] text-[13px] font-semibold text-[var(--text-primary)]">
              <span>hermes-memory-config.json ({t("resolved", undefined, "resolved")})</span>
              <button type="button" className="text-[var(--text-secondary)]" onClick={() => setShowRaw(false)}>
                {t("close", undefined, "Close")}
              </button>
            </div>
            <div className="p-4">
              <pre className="m-0 font-mono text-[11.5px] text-[var(--text-secondary)] bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded-lg p-3 max-h-[52vh] overflow-auto whitespace-pre">
                {JSON.stringify(buildResolvedConfig(values, overridden), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One field row ────────────────────────────────────────────────
function FieldRow({
  meta,
  value,
  isOverridden,
  error,
  onChange,
  onReset,
  t,
}: {
  meta: FieldMeta;
  value: unknown;
  isOverridden: boolean;
  error: string | null;
  onChange: (v: unknown) => void;
  onReset: () => void;
  t: ReturnType<typeof useT>;
}): React.ReactElement {
  return (
    <div className="py-3 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-[var(--text-primary)] font-medium">{meta.label}</span>
        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{meta.key}</span>
        {!isOverridden && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-1.5"
            data-testid={`hermes-default-badge-${meta.key}`}
          >
            {t("defaultBadge", undefined, "default")}
          </span>
        )}
        {isOverridden && (
          <button
            type="button"
            className="ml-auto text-[11px] text-[var(--accent-blue)]"
            onClick={onReset}
            data-testid={`hermes-reset-${meta.key}`}
          >
            {t("reset", undefined, "Reset")}
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-[var(--text-tertiary)] mt-1.5 mb-0">{meta.help}</p>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <FieldControl meta={meta} value={value} onChange={onChange} />
        {meta.unit && <span className="text-[11px] text-[var(--text-tertiary)]">{meta.unit}</span>}
      </div>
      {error && <p className="text-[11px] text-[var(--accent-red)] mt-1 mb-0">{error}</p>}
    </div>
  );
}

// ── Control by descriptor kind ───────────────────────────────────
const inputCls =
  "font-mono text-[12.5px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--accent-primary)]";

function FieldControl({
  meta,
  value,
  onChange,
}: {
  meta: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
}): React.ReactElement {
  const desc = FIELD_DESCRIPTORS[meta.key];
  const key = meta.key as keyof MemoryConfig;

  switch (desc.kind) {
    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={`hermes-input-${key}`}
          />
          <span className="text-[12px] text-[var(--text-secondary)]">{value ? "On" : "Off"}</span>
        </label>
      );
    case "number":
      return (
        <input
          type="number"
          className={`${inputCls} w-[150px]`}
          value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          data-testid={`hermes-input-${key}`}
        />
      );
    case "string":
      return (
        <input
          type="text"
          className={`${inputCls} w-full max-w-[340px]`}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`hermes-input-${key}`}
        />
      );
    case "enum": {
      const hasNoDefault = (DEFAULTS as Record<string, unknown>)[key] === undefined;
      const current = typeof value === "string" ? value : "";
      return (
        <select
          className={`${inputCls} max-w-[340px]`}
          value={current}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          data-testid={`hermes-input-${key}`}
        >
          {hasNoDefault && <option value="">(inherit / unset)</option>}
          {desc.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    }
    case "sessionSearch": {
      const variant = typeof value === "object" && value !== null ? (value as { variant?: string }).variant ?? "legacy" : "legacy";
      return (
        <select
          className={`${inputCls} max-w-[340px]`}
          value={variant}
          onChange={(e) => onChange({ variant: e.target.value })}
          data-testid={`hermes-input-${key}`}
        >
          <option value="legacy">legacy</option>
          <option value="anchors">anchors</option>
        </select>
      );
    }
    case "stringArray":
    case "regexArray":
      return (
        <textarea
          className={`${inputCls} w-full font-mono text-[11.5px] min-h-[64px] resize-y`}
          value={arrayToLines(value)}
          onChange={(e) => onChange(linesToArray(e.target.value))}
          data-testid={`hermes-input-${key}`}
        />
      );
  }
}
