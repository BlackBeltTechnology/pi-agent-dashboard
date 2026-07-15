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

import { useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
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
  useSettingsDraftSource({ id: "plugin:flows", page: "plugins", isDirty, commit, reset });

  return (
    <section className="border border-[var(--border-primary)] rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-0.5">{t("flowsHeading", undefined, "Flows")}</h3>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        Multi-agent workflow orchestration. Applies globally; sessions inherit this default.
      </p>
      <label className="flex gap-2.5 items-start text-[13px] cursor-pointer">
        <input
          type="checkbox"
          checked={editFlow}
          onChange={(e) => setEditFlow(e.target.checked)}
          className="mt-0.5"
          data-testid="flows-edit-mode-toggle"
        />
        <span>
          <span className="font-medium">{t("editModeLabel", undefined, "Edit mode")}</span>
          {" — allow the main session to author flows & agents"}
          <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">
            Activates <code>flow_agents</code> / <code>flow_write</code> and makes the
            edit-flow skill model-visible. Off by default.
          </span>
        </span>
      </label>
    </section>
  );
}
