/**
 * Settings-section form for the automation-plugin's configSchema:
 *   - defaultVisibility (hidden | shown) — applied to automations that omit
 *     their own `visibility`
 *   - retentionPerAutomation — keep-N run records
 *   - scanFolderScope / scanGlobalScope — which scopes are scanned
 *   - defaultModel — fallback when an `@role` can't be resolved
 *
 * Uses the unified buffered-draft save contract (edits commit via the host
 * Settings panel's Save). See change: add-automation-plugin.
 */

import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useSettingsDraftSource, useT, useUiPrimitive, usePluginConfigOf } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { useCallback, useRef, useState } from "react";
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

  const [defaultVisibility, setDefaultVisibility] = useState<Visibility>(
    config.defaultVisibility ?? DEFAULTS.defaultVisibility,
  );
  const [retention, setRetention] = useState<number>(
    config.retentionPerAutomation ?? DEFAULTS.retentionPerAutomation,
  );
  const [scanFolder, setScanFolder] = useState<boolean>(config.scanFolderScope ?? DEFAULTS.scanFolderScope);
  const [scanGlobal, setScanGlobal] = useState<boolean>(config.scanGlobalScope ?? DEFAULTS.scanGlobalScope);
  const [defaultModel, setDefaultModel] = useState<string>(config.defaultModel ?? DEFAULTS.defaultModel);

  const baseVis = config.defaultVisibility ?? DEFAULTS.defaultVisibility;
  const baseRet = config.retentionPerAutomation ?? DEFAULTS.retentionPerAutomation;
  const baseScanFolder = config.scanFolderScope ?? DEFAULTS.scanFolderScope;
  const baseScanGlobal = config.scanGlobalScope ?? DEFAULTS.scanGlobalScope;
  const baseModel = config.defaultModel ?? DEFAULTS.defaultModel;

  const isDirty =
    defaultVisibility !== baseVis ||
    retention !== baseRet ||
    scanFolder !== baseScanFolder ||
    scanGlobal !== baseScanGlobal ||
    defaultModel !== baseModel;

  const valuesRef = useRef({ defaultVisibility, retention, scanFolder, scanGlobal, defaultModel });
  valuesRef.current = { defaultVisibility, retention, scanFolder, scanGlobal, defaultModel };
  const baseRef = useRef({ baseVis, baseRet, baseScanFolder, baseScanGlobal, baseModel });
  baseRef.current = { baseVis, baseRet, baseScanFolder, baseScanGlobal, baseModel };

  const commit = useCallback(async () => {
    const v = valuesRef.current;
    await send({
      type: "plugin_config_write",
      id: "automation",
      config: {
        defaultVisibility: v.defaultVisibility,
        retentionPerAutomation: v.retention,
        scanFolderScope: v.scanFolder,
        scanGlobalScope: v.scanGlobal,
        defaultModel: v.defaultModel,
      },
    });
  }, [send]);
  const reset = useCallback(() => {
    const b = baseRef.current;
    setDefaultVisibility(b.baseVis);
    setRetention(b.baseRet);
    setScanFolder(b.baseScanFolder);
    setScanGlobal(b.baseScanGlobal);
    setDefaultModel(b.baseModel);
  }, []);
  useSettingsDraftSource({ id: "plugin:automation", isDirty, commit, reset });

  return (
    // No self-header: the host owns identity + status chrome (design D1).
    <div className="space-y-3" data-testid="automation-plugin-settings">
      <p className="text-xs text-[var(--text-secondary)]">{t("settingsGlobalNote", undefined, "Plugin settings apply globally across all repos.")}</p>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">{t("defaultVisibilityLabel", undefined, "Default run visibility")}</span>
        <select
          value={defaultVisibility}
          onChange={(e) => setDefaultVisibility(e.target.value as Visibility)}
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]"
          data-testid="automation-default-visibility"
        >
          <option value="hidden">{t("visibilityHiddenOption", undefined, "hidden (off the board, watch in Automations)")}</option>
          <option value="shown">{t("visibilityShownOption", undefined, "shown (render as a normal board card)")}</option>
        </select>
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">{t("retentionLabel", undefined, "Run retention (keep last N per automation)")}</span>
        <input
          type="number"
          min={1}
          value={retention}
          onChange={(e) => setRetention(Math.max(1, Number(e.target.value) || DEFAULTS.retentionPerAutomation))}
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] w-24"
          data-testid="automation-retention"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={scanFolder}
          onChange={(e) => setScanFolder(e.target.checked)}
          data-testid="automation-scan-folder"
        />
        {t("scanFolderLabel", undefined, "Scan per-folder automations")} (<code>&lt;repo&gt;/.pi/automation/</code>)
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={scanGlobal}
          onChange={(e) => setScanGlobal(e.target.checked)}
          data-testid="automation-scan-global"
        />
        {t("scanGlobalLabel", undefined, "Scan global automations")} (<code>~/.pi/automation/</code>)
      </label>

      <div className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">{t("defaultModelLabel", undefined, "Default model (fallback for unresolved")} <code>@role</code>)</span>
        {/* Caption + control are SIBLINGS (not wrapped in a <label>): the picker
            trigger is a <button>, and a label click would open the dropdown. */}
        <div className="flex items-center gap-1.5" data-testid="automation-default-model">
          <ModelSelector
            current={defaultModel || undefined}
            models={models}
            placeholder={t("defaultModelPlaceholder", undefined, "Select a model…")}
            onSelect={(label: string) => setDefaultModel(label)}
          />
          <button
            type="button"
            onClick={() => setDefaultModel("")}
            aria-label={t("defaultModelClear", undefined, "Clear default model")}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-none"
            data-testid="automation-default-model-clear"
          >
            <Icon path={mdiClose} size={0.6} />
          </button>
        </div>
      </div>
    </div>
  );
}
