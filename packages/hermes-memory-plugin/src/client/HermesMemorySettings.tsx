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
 * Fields, groups and notices come from the shared settings field family in
 * `dashboard-plugin-runtime`; nothing here paints with an `--accent-*` text colour.
 *
 * See change: add-hermes-memory-settings-plugin, retro-ux-plugin-settings-forms.
 */
import {
  FieldShell,
  NumberField,
  SelectField,
  SettingsGroup,
  SettingsNotice,
  TextAreaField,
  TextField,
  ToggleField,
  useSettingsDraftSource,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
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
  const rawOpenerRef = useRef<HTMLButtonElement>(null);

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
    // Dirty means "has unsaved edits", NOT "has valid unsaved edits". Clearing
    // it on a validation error would hide the Save Bar and make invalid edits
    // look committed; `commit` rejects instead, which keeps the source dirty
    // and offers Retry.
    isDirty: changedCount > 0,
    commit: async () => {
      if (hasErrors) {
        throw new Error(
          t("fixInvalidFields", undefined, "Fix the invalid fields before saving."),
        );
      }
      await putConfig(buildResolvedConfig(values, overridden));
      await load();
    },
    reset: () => {
      void load();
    },
  });

  if (loadError) {
    return (
      <SettingsNotice tone="error" testId="hermes-load-error">
        {t("loadError", { error: loadError }, `Failed to load config: ${loadError}`)}
      </SettingsNotice>
    );
  }
  if (!effective) {
    return (
      <div data-testid="hermes-loading" className="text-sm text-[var(--text-secondary)]">
        {t("loading", undefined, "Loading…")}
      </div>
    );
  }

  return (
    <div data-testid="hermes-root" className="pb-24 text-sm text-[var(--text-secondary)]">
      {/* prefers-reduced-motion guard (6.3) */}
      <style>{"@media (prefers-reduced-motion: reduce){.hm-motion{transition:none !important}}"}</style>

      <p className="mb-2 text-xs text-[var(--text-secondary)]">
        {t("intro", undefined, "Configuration for the")}{" "}
        <code className="font-mono text-[12px]">pi-hermes-memory</code>{" "}
        {t("introTail", undefined, "extension. Fields left at their default track the extension's built-in value.")}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span>{t("file", undefined, "File:")}</span>
        <span
          className="rounded border border-[var(--border-secondary)] px-1.5 font-mono text-[12px] text-[var(--text-primary)]"
          data-testid="hermes-file-path"
        >
          {effective.filePath}
        </span>
        <span>· {effective.exists ? t("exists", undefined, "exists") : t("notCreated", undefined, "not yet created")}</span>
      </div>

      <SettingsNotice tone="info" className="mb-4">
        {t(
          "newSessionsNotice",
          undefined,
          "Changes apply to newly started sessions. Hermes reads its config once at extension load, so running sessions keep their current settings until restarted.",
        )}
      </SettingsNotice>

      {FIELD_GROUPS.map((group) => {
        const groupDirty = group.fields.some((f) => isDirty(f.key));
        return (
          <SettingsGroup
            key={group.title}
            defaultOpen={false}
            title={
              <>
                {group.title}
                {groupDirty && (
                  <span className="rounded-full border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] px-1.5 py-px text-[11px] font-semibold text-[var(--severity-info-fg)]">
                    {t("groupChanged", undefined, "changed")}
                  </span>
                )}
              </>
            }
            meta={`${group.fields.length} ${t("fields", undefined, "fields")}`}
          >
            {group.fields.map((meta) => {
              if (meta.key === "memoryPolicyCustomText" && !showCustomText) return null;
              return (
                <Field
                  key={meta.key}
                  meta={meta}
                  value={values[meta.key]}
                  isOverridden={overridden.has(meta.key)}
                  error={overridden.has(meta.key) ? fieldError(meta.key, values[meta.key], t) : null}
                  onChange={(v) => setField(meta.key, v)}
                  onReset={() => resetField(meta.key)}
                  t={t}
                />
              );
            })}
          </SettingsGroup>
        );
      })}

      {/* No save footer: the host Settings panel owns Save/Discard through the
          global Save Bar, and a `position: fixed` bar here overlaid every
          settings page. See change: plugin-settings-pages (design D5). */}
      <div className="flex flex-wrap items-center gap-2.5">
        {changedCount ? (
          <span
            role="status"
            data-testid="hermes-change-status"
            className="inline-flex items-center rounded-full border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-1.5 py-px text-[11px] font-semibold text-[var(--severity-warning-fg)]"
          >
            {t("nChanged", { count: changedCount }, `${changedCount} field${changedCount > 1 ? "s" : ""} changed · not yet saved`)}
          </span>
        ) : (
          <span role="status" data-testid="hermes-change-status" className="text-xs text-[var(--text-secondary)]">
            {t("noChanges", undefined, "No changes")}
          </span>
        )}
        {saveError && <SettingsNotice tone="error">{saveError}</SettingsNotice>}
        <span className="ml-auto" />
        <button
          ref={rawOpenerRef}
          type="button"
          className="focus-ring min-h-[44px] rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 text-xs text-[var(--text-primary)] sm:min-h-[36px]"
          onClick={() => setShowRaw(true)}
        >
          {t("viewRawJson", undefined, "View raw JSON")}
        </button>
      </div>

      {showRaw && (
        <RawJsonDialog
          json={JSON.stringify(buildResolvedConfig(values, overridden), null, 2)}
          opener={rawOpenerRef}
          onClose={() => setShowRaw(false)}
          t={t}
        />
      )}
    </div>
  );
}

/** Keep Tab / Shift+Tab inside `panel`: wrap at the ends, pull stray focus back in. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const focusable = panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const inside = panel.contains(active);
  if (e.shiftKey ? !inside || active === first : !inside || active === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

// ── Raw-JSON dialog: scrim, focus trap, Escape, focus return ──────────────
function RawJsonDialog({
  json,
  opener,
  onClose,
  t,
}: {
  json: string;
  opener: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  t: ReturnType<typeof useT>;
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = "hermes-raw-title";

  // The parent passes an inline arrow, so depending on `onClose` would restart this effect
  // (re-focusing Close, re-binding the listener) on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const openerEl = opener.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab" && panelRef.current) {
        trapTab(e, panelRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openerEl?.focus();
    };
  }, [opener]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--bg-overlay)]" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="w-[92vw] max-w-[640px] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-secondary)] px-4 py-3">
          <div className="min-w-0">
            <h3 id={titleId} className="m-0 text-sm font-semibold text-[var(--text-primary)]">
              {t("rawTitle", undefined, "Resolved configuration")}
            </h3>
            <p className="m-0 font-mono text-[12px] text-[var(--text-secondary)]">hermes-memory-config.json</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="focus-ring min-h-[44px] rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 text-xs text-[var(--text-primary)] sm:min-h-[36px]"
            onClick={onClose}
          >
            {t("close", undefined, "Close")}
          </button>
        </div>
        <div className="p-4">
          <pre className="m-0 max-h-[52vh] overflow-auto whitespace-pre rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-code)] p-3 font-mono text-[12px] text-[var(--text-secondary)]">
            {json}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── One field, rendered through the shared field family ───────────────────
function Field({
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
  const desc = FIELD_DESCRIPTORS[meta.key];
  const key = meta.key as keyof MemoryConfig;
  const testId = `hermes-input-${key}`;
  const shared = {
    label: meta.label,
    keyLabel: meta.key,
    unit: meta.unit,
    hint: meta.help,
    error,
    // The DEFAULT badge exists only while the value is unset; an override shows the reset control instead.
    state: isOverridden ? undefined : ("default" as const),
    stateLabel: t("defaultBadge", undefined, "default"),
    onReset: isOverridden ? onReset : undefined,
    resetLabel: t("reset", undefined, "Reset"),
    testIds: { control: testId, state: `hermes-default-badge-${key}`, reset: `hermes-reset-${key}` },
  };

  switch (desc.kind) {
    case "boolean":
      return (
        <ToggleField
          {...shared}
          value={value === true}
          onChange={onChange}
          onLabel={t("on", undefined, "On")}
          offLabel={t("off", undefined, "Off")}
        />
      );
    case "number":
      return (
        <NumberField
          {...shared}
          value={typeof value === "number" ? value : Number.NaN}
          onChange={onChange}
          decimal
          allowEmpty
          step="any"
        />
      );
    case "model":
      return <ModelField {...shared} fieldKey={key} value={value} onChange={onChange} onReset={onReset} t={t} />;
    case "string":
      return <TextField {...shared} mono value={typeof value === "string" ? value : ""} onChange={onChange} />;
    case "enum": {
      const hasNoDefault = (DEFAULTS as Record<string, unknown>)[key] === undefined;
      const current = typeof value === "string" ? value : "";
      const options = desc.values.map((v) => ({ value: v, label: v }));
      return (
        <SelectField
          {...shared}
          value={current}
          options={hasNoDefault ? [{ value: "", label: t("inheritUnset", undefined, "(inherit / unset)") }, ...options] : options}
          onChange={(v) => onChange(v === "" ? undefined : v)}
        />
      );
    }
    case "sessionSearch": {
      const variant = typeof value === "object" && value !== null ? ((value as { variant?: string }).variant ?? "legacy") : "legacy";
      return (
        <SelectField
          {...shared}
          value={variant}
          options={[
            { value: "legacy", label: "legacy" },
            { value: "anchors", label: "anchors" },
          ]}
          onChange={(v) => onChange({ variant: v })}
        />
      );
    }
    case "stringArray":
    case "regexArray":
      return <TextAreaField {...shared} mono value={arrayToLines(value)} onChange={(v) => onChange(linesToArray(v))} />;
  }
}

// ── Model override: shared model selector fed from /api/models ────────────────
// See change: add-context-mode-settings-plugin (D7).

interface ModelRow {
  id: string;
  provider: string;
}

/** `/api/models` rows (`id` is `provider/id`) → the selector's bare-id `ModelInfo[]`. */
function toModelInfo(rows: ModelRow[]): ModelInfo[] {
  return rows.map((r) => {
    const prefix = `${r.provider}/`;
    return { provider: r.provider, id: r.id.startsWith(prefix) ? r.id.slice(prefix.length) : r.id };
  });
}

function ModelField({
  fieldKey,
  value,
  onChange,
  onReset: onInherit,
  t,
  ...shell
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  onReset: () => void;
  t: ReturnType<typeof useT>;
} & Omit<React.ComponentProps<typeof FieldShell>, "control" | "stacked">): React.ReactElement {
  const ModelSelector = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);
  const [, navigate] = useLocation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/models", { signal: ac.signal });
        if (res.ok) {
          const json = (await res.json()) as { data?: ModelRow[] };
          setModels(toModelInfo(Array.isArray(json.data) ? json.data : []));
        }
      } catch {
        // list stays empty; the stored value is still shown via `current`
      }
      if (!ac.signal.aborted) setModelsLoaded(true);
    })();
    return () => ac.abort();
  }, []);

  // A stored value missing from the list is still passed as `current` so it
  // stays visible and round-trips unchanged.
  const current = typeof value === "string" && value !== "" ? value : undefined;
  const noModels = modelsLoaded && models.length === 0;
  return (
    <div>
      <FieldShell
        {...shell}
        stacked
        control={({ id, describedBy, invalid }) => (
          <div
            id={id}
            role="group"
            aria-label={shell.label}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="flex flex-wrap items-center gap-2"
            data-testid={`hermes-input-${fieldKey}`}
          >
            {ModelSelector ? (
              <ModelSelector current={current} models={models} onSelect={(label: string) => onChange(label)} />
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">
                {t("modelSelectorUnavailable", undefined, "Model selector unavailable")}
              </span>
            )}
            <button
              type="button"
              className="focus-ring rounded text-[12px] font-semibold text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
              onClick={onInherit}
              data-testid={`hermes-inherit-${fieldKey}`}
            >
              {t("inheritSessionModel", undefined, "Inherit session model")}
            </button>
          </div>
        )}
      />
      {(noModels || !ModelSelector) && (
        <SettingsNotice tone="info" testId={`hermes-no-models-${fieldKey}`} className="mt-1.5">
          <span>{t("noModels", undefined, "No models are available. Add a provider, then choose a model.")}</span>{" "}
          <button
            type="button"
            className="focus-ring rounded font-semibold underline"
            onClick={() => navigate("/settings/providers")}
          >
            {t("openProviders", undefined, "Open Providers")}
          </button>
        </SettingsNotice>
      )}
    </div>
  );
}
