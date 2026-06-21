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
import React, { useCallback, useRef, useState } from "react";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
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
  const config = usePluginConfig<AutomationPluginConfig>();
  const send = usePluginSend();

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
    send({
      type: "plugin_config_write" as never,
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
  useSettingsDraftSource({ id: "plugin:automation", page: "plugins", isDirty, commit, reset });

  return (
    <section
      className="border border-[var(--border-secondary)] rounded-lg p-4 space-y-3"
      data-testid="automation-plugin-settings"
    >
      <header>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Automations</h3>
        <p className="text-xs text-[var(--text-secondary)]">Plugin settings apply globally across all repos.</p>
      </header>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">Default run visibility</span>
        <select
          value={defaultVisibility}
          onChange={(e) => setDefaultVisibility(e.target.value as Visibility)}
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]"
          data-testid="automation-default-visibility"
        >
          <option value="hidden">hidden (off the board, watch in Automations)</option>
          <option value="shown">shown (render as a normal board card)</option>
        </select>
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">Run retention (keep last N per automation)</span>
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
        Scan per-folder automations (<code>&lt;repo&gt;/.pi/automation/</code>)
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={scanGlobal}
          onChange={(e) => setScanGlobal(e.target.checked)}
          data-testid="automation-scan-global"
        />
        Scan global automations (<code>~/.pi/automation/</code>)
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">Default model (fallback for unresolved <code>@role</code>)</span>
        <input
          type="text"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder="provider/model-id"
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] font-mono w-full"
          data-testid="automation-default-model"
        />
      </label>
    </section>
  );
}
