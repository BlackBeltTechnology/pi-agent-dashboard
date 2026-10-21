/**
 * Settings-section form for the automation-plugin's configSchema, in three kit
 * groups (Runs · Where automations are found · Model):
 *   - defaultVisibility (hidden | shown) — applied to automations that omit
 *     their own `visibility`
 *   - retentionPerAutomation — keep-N run records; empty or < 1 is a field error
 *     (never a silent snap to 100)
 *   - scanFolderScope / scanGlobalScope — which scopes are scanned
 *   - defaultModel — fallback when an `@role` can't be resolved (picker inside a
 *     `FieldShell` so the label, hint and clear control are wired together)
 *
 * Uses the unified buffered-draft save contract (draft id `plugin:automation`):
 * edits are held per key, commit sends ONLY the edited keys (the server merges),
 * unedited keys follow `plugin_config_update`.
 * See changes: add-automation-plugin, retro-ux-plugin-settings-wave-2.
 */

import { FieldShell, NumberField, SelectField, SettingsGroup, ToggleField, usePluginConfig, usePluginConfigOf, usePluginSend, useSettingsDraftSource, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Visibility } from "../shared/automation-types.js";

export interface AutomationPluginConfig {
  defaultVisibility?: Visibility;
  retentionPerAutomation?: number;
  scanFolderScope?: boolean;
  scanGlobalScope?: boolean;
  defaultModel?: string;
}

const DEFAULTS: Required<AutomationPluginConfig> = {
  defaultVisibility: "hidden",
  retentionPerAutomation: 100,
  scanFolderScope: true,
  scanGlobalScope: true,
  defaultModel: "",
};

type Edits = Partial<Required<AutomationPluginConfig>>;
type EditableKey = keyof Required<AutomationPluginConfig>;

const FIELD_KEYS = Object.keys(DEFAULTS) as EditableKey[];

/** Same value, treating two NaN (an emptied number) as equal. */
const same = (a: unknown, b: unknown): boolean => Object.is(a, b) || a === b;

export function AutomationSettings(): React.ReactElement {
  const t = useT();
  const config = usePluginConfig<AutomationPluginConfig>();
  const send = usePluginSend();
  const ModelSelector = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  // Catalogue lives in the roles plugin's config; read reactively so the picker
  // fills in when `models_list` / `/api/config` hydration lands after mount.
  // See change: model-picker-everywhere-favorites (design D3).
  const rolesConfig = usePluginConfigOf<{
    models?: Array<{ provider: string; id: string }>;
  }>("roles");
  const models = rolesConfig.models ?? [];

  const [edits, setEdits] = useState<Edits>({});

  // A broadcast that now equals an edit settles it (saved here or elsewhere), so a
  // stale edit never shadows a later broadcast.
  useEffect(() => {
    setEdits((prev) => {
      const settled = (Object.keys(prev) as EditableKey[]).filter((k) => same(prev[k], config[k] ?? DEFAULTS[k]));
      if (settled.length === 0) return prev;
      const next = { ...prev };
      for (const k of settled) delete next[k];
      return next;
    });
  }, [config]);

  const value = <K extends EditableKey>(key: K): Required<AutomationPluginConfig>[K] =>
    (key in edits ? edits[key] : (config[key] ?? DEFAULTS[key])) as Required<AutomationPluginConfig>[K];
  const defaultVisibility = value("defaultVisibility");
  const retention = value("retentionPerAutomation");
  const scanFolder = value("scanFolderScope");
  const scanGlobal = value("scanGlobalScope");
  const defaultModel = value("defaultModel");

  // Whole runs only, at least 1: empty / 0 / negative are invalid, never coerced.
  const retentionError =
    Number.isInteger(retention) && retention >= 1 ? null : t("retentionError", undefined, "Enter 1 or more.");

  const changed: Edits = {};
  for (const k of FIELD_KEYS) {
    if (k in edits && !same(edits[k], config[k] ?? DEFAULTS[k])) (changed as Record<string, unknown>)[k] = edits[k];
  }
  const isDirty = Object.keys(changed).length > 0;

  const latest = useRef({ changed, retentionError });
  latest.current = { changed, retentionError };
  const commit = useCallback(async () => {
    const { changed: payload, retentionError: err } = latest.current;
    if (err) throw new Error(err);
    if (Object.keys(payload).length === 0) return;
    await send({ type: "plugin_config_write", id: "automation", config: payload });
  }, [send]);
  const reset = useCallback(() => setEdits({}), []);
  useSettingsDraftSource({ id: "plugin:automation", isDirty, commit, reset });

  const edit = (patch: Edits) => setEdits((prev) => ({ ...prev, ...patch }));
  const state = (key: EditableKey) => (same(value(key), DEFAULTS[key]) ? "default" : "changed");

  const code = (text: string) => <code className="font-mono text-[12px]">{text}</code>;

  return (
    // No self-header: the host owns identity + status chrome (design D1).
    <div className="space-y-3" data-testid="automation-plugin-settings">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("settingsGlobalNote", undefined, "Defaults for every automation, in all folders.")}
      </p>

      <SettingsGroup title={t("groupRuns", undefined, "Runs")}>
        <SelectField
          label={t("defaultVisibilityLabel", undefined, "Default run visibility")}
          hint={t(
            "visibilityHint",
            undefined,
            "Hidden runs stay off the board; watch them in Automations. Used for automations that don't set their own.",
          )}
          value={defaultVisibility}
          options={[
            { value: "hidden", label: t("visibilityHiddenOption", undefined, "Hidden") },
            { value: "shown", label: t("visibilityShownOption", undefined, "Shown") },
          ]}
          onChange={(v) => edit({ defaultVisibility: v as Visibility })}
          state={state("defaultVisibility")}
          testIds={{ control: "automation-default-visibility" }}
        />
        <NumberField
          label={t("retentionLabel", undefined, "Runs to keep")}
          unit={t("retentionUnit", undefined, "per automation")}
          hint={t("retentionHint", undefined, "Older runs are deleted. Minimum 1.")}
          value={retention}
          allowEmpty
          onChange={(v) => edit({ retentionPerAutomation: v })}
          error={retentionError}
          state={state("retentionPerAutomation")}
          testIds={{ control: "automation-retention" }}
        />
      </SettingsGroup>

      <SettingsGroup title={t("groupScan", undefined, "Where automations are found")}>
        <ToggleField
          label={t("scanFolderLabel", undefined, "Folder automations")}
          hint={
            <>
              {t("scanFolderHintPre", undefined, "Reads")} {code("<repo>/.pi/automation/")}{" "}
              {t("scanFolderHintPost", undefined, "in every tracked folder.")}
            </>
          }
          value={scanFolder}
          onChange={(v) => edit({ scanFolderScope: v })}
          state={state("scanFolderScope")}
          testIds={{ control: "automation-scan-folder" }}
        />
        <ToggleField
          label={t("scanGlobalLabel", undefined, "Global automations")}
          hint={
            <>
              {t("scanGlobalHintPre", undefined, "Reads")} {code("~/.pi/automation/")}.
            </>
          }
          value={scanGlobal}
          onChange={(v) => edit({ scanGlobalScope: v })}
          state={state("scanGlobalScope")}
          testIds={{ control: "automation-scan-global" }}
        />
      </SettingsGroup>

      <SettingsGroup title={t("groupModel", undefined, "Model")}>
        {/* The picker trigger is a <button>: FieldShell's <label htmlFor> is a SIBLING
            of the control (never a wrapper), so a label click cannot open the dropdown. */}
        <FieldShell
          label={t("defaultModelLabel", undefined, "Fallback model")}
          stacked
          hint={
            <>
              {t("defaultModelHintPre", undefined, "Used when an automation asks for a")} {code("@role")}{" "}
              {t("defaultModelHintPost", undefined, "that has no model.")}
              {models.length === 0 ? ` ${t("defaultModelNoModels", undefined, "No models are available yet.")}` : ""}
            </>
          }
          state={state("defaultModel")}
          control={({ id, describedBy }) => (
            <div
              id={id}
              role="group"
              aria-label={t("defaultModelLabel", undefined, "Fallback model")}
              aria-describedby={describedBy}
              className="flex items-center gap-1.5"
              data-testid="automation-default-model"
            >
              <ModelSelector
                current={defaultModel || undefined}
                models={models}
                placeholder={t("defaultModelPlaceholder", undefined, "Select a model…")}
                onSelect={(label: string) => edit({ defaultModel: label })}
              />
              <button
                type="button"
                onClick={() => edit({ defaultModel: "" })}
                aria-label={t("defaultModelClear", undefined, "Clear fallback model")}
                className="focus-ring inline-flex min-h-[32px] min-w-[32px] flex-none items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                data-testid="automation-default-model-clear"
              >
                <Icon path={mdiClose} size={0.7} aria-hidden="true" />
              </button>
            </div>
          )}
        />
      </SettingsGroup>
    </div>
  );
}
