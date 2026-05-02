/**
 * Settings-section form for the jj-plugin's configSchema.
 *
 * Phase 4 minimal implementation: reads config via `usePluginConfig`,
 * writes via `usePluginSend({ type: "plugin_config_write" })`. Full
 * RJSF rendering lands once the runtime exposes `rjsf-form` slots
 * generally; for now we render four explicit fields matching the
 * configSchema.json (defaultPushTarget, workspaceRoot, allowDirectTrunkPush,
 * showInitColocatedSuggestion).
 *
 * See change: add-jj-workspace-plugin.
 */
import React, { useState } from "react";
import {
  usePluginConfig,
  usePluginSend,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";

export interface JjPluginConfig {
  defaultPushTarget?: "trunk" | "bookmark";
  workspaceRoot?: string;
  allowDirectTrunkPush?: boolean;
  showInitColocatedSuggestion?: boolean;
}

const DEFAULTS: Required<JjPluginConfig> = {
  defaultPushTarget: "bookmark",
  workspaceRoot: ".shadow",
  allowDirectTrunkPush: false,
  showInitColocatedSuggestion: false,
};

export function JjPluginSettings(): React.ReactElement {
  const config = usePluginConfig<JjPluginConfig>();
  const send = usePluginSend();

  const [defaultPushTarget, setDefaultPushTarget] = useState<"trunk" | "bookmark">(
    config.defaultPushTarget ?? DEFAULTS.defaultPushTarget,
  );
  const [workspaceRoot, setWorkspaceRoot] = useState<string>(
    config.workspaceRoot ?? DEFAULTS.workspaceRoot,
  );
  const [allowDirectTrunkPush, setAllowDirectTrunkPush] = useState<boolean>(
    config.allowDirectTrunkPush ?? DEFAULTS.allowDirectTrunkPush,
  );
  const [showInit, setShowInit] = useState<boolean>(
    config.showInitColocatedSuggestion ?? DEFAULTS.showInitColocatedSuggestion,
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSave = () => {
    send({
      type: "plugin_config_write" as never,
      id: "jj",
      config: {
        defaultPushTarget,
        workspaceRoot,
        allowDirectTrunkPush,
        showInitColocatedSuggestion: showInit,
      },
    });
    setSavedAt(Date.now());
  };

  return (
    <section
      className="border border-[var(--border-secondary)] rounded-lg p-4 space-y-3"
      data-testid="jj-plugin-settings"
    >
      <header>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Jujutsu Workspaces
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">
          Plugin settings apply globally across all repos.
        </p>
      </header>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">Default push target</span>
        <select
          value={defaultPushTarget}
          onChange={(e) => setDefaultPushTarget(e.target.value as "trunk" | "bookmark")}
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]"
          data-testid="jj-default-push-target"
        >
          <option value="bookmark">bookmark (recommended)</option>
          <option value="trunk">trunk</option>
        </select>
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">Workspace root (relative to repo)</span>
        <input
          type="text"
          value={workspaceRoot}
          onChange={(e) => setWorkspaceRoot(e.target.value)}
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] font-mono"
          data-testid="jj-workspace-root"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={allowDirectTrunkPush}
          onChange={(e) => setAllowDirectTrunkPush(e.target.checked)}
          data-testid="jj-allow-direct-trunk-push"
        />
        Allow fold-back to push directly to <code>main</code>/<code>master</code>/<code>trunk</code>
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={showInit}
          onChange={(e) => setShowInit(e.target.checked)}
          data-testid="jj-show-init-suggestion"
        />
        Show "Enable jj workspaces" affordance on plain-git sessions
      </label>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onSave}
          className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500"
          data-testid="jj-settings-save"
        >
          Save
        </button>
        {savedAt && (
          <span className="text-[10px] text-[var(--text-secondary)]">
            Saved at {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </section>
  );
}
