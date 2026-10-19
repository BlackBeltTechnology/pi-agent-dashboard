/**
 * Settings-section for the flows plugin: a global edit-mode default.
 *
 * Edit-mode on → the main session sees the `edit-flow` skill and the
 * `flow_agents` / `flow_write` authoring tools. The global default here is
 * reconciled down to each session (via `flow:set-edit-mode`) when that
 * session's flows plugin becomes available — see SessionFlowActionsClaim.
 *
 * Uses the unified buffered-draft save contract (commits via the host Settings
 * panel's Save). See change: rework-flows-plugin-for-new-pi-flows.
 */

import { ToggleField, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type React from "react";
import { useCallback, useRef, useState } from "react";

export interface FlowsPluginConfig {
  /** Global default for pi-flows `flows.editFlow`. Default off. */
  editFlow?: boolean;
}

export function FlowsSettings(): React.ReactElement {
  const t = useT();
  const config = usePluginConfig<FlowsPluginConfig>();
  const send = usePluginSend();

  const [editFlow, setEditFlow] = useState<boolean>(config.editFlow ?? false);
  const base = config.editFlow ?? false;
  const isDirty = editFlow !== base;

  const valuesRef = useRef(editFlow);
  valuesRef.current = editFlow;
  const baseRef = useRef(base);
  baseRef.current = base;

  const commit = useCallback(async () => {
    await send({ type: "plugin_config_write", id: "flows", config: { editFlow: valuesRef.current } });
  }, [send]);
  const reset = useCallback(() => setEditFlow(baseRef.current), []);
  useSettingsDraftSource({ id: "plugin:flows", isDirty, commit, reset });

  const codeCls = "font-mono text-[12px] text-[var(--text-primary)]";
  return (
    // No self-header: the host owns identity + status chrome (design D1).
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("settingsIntro", undefined, "Multi-agent workflows. This is the default for every session.")}
      </p>
      <ToggleField
        label={t("editModeLabel", undefined, "Edit mode")}
        hint={
          <>
            {t("editModeHintPre", undefined, "Lets the main session create and change flows and agents. Turns on")}{" "}
            <code className={codeCls}>flow_agents</code> / <code className={codeCls}>flow_write</code>{" "}
            {t("editModeHintPost", undefined, "and the edit-flow skill. Off by default.")}
          </>
        }
        value={editFlow}
        onChange={setEditFlow}
        testIds={{ control: "flows-edit-mode-toggle" }}
      />
    </div>
  );
}
