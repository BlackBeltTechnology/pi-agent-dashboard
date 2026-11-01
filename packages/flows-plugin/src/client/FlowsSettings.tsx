/**
 * Settings-section for the flows plugin: the global edit-mode default.
 *
 * Edit-mode on → the main session sees the `manage-flows` skill and the
 * `flow_agents` / `flow_write` authoring tools. The toggle reads/writes
 * `flows.editFlow` in the global pi settings file (`~/.pi/agent/settings.json`,
 * which pi-flows reads) via `GET|PUT /api/plugins/flows/edit-mode-default`.
 * It never writes a project `.pi/settings.json`; a project value set from the
 * session menu overrides it. pi-flows picks the change up at the next turn.
 *
 * Uses the unified buffered-draft save contract (commits via the host Settings
 * panel's Save; a failed PUT rejects so the draft stays dirty, and a parse
 * error is shown here). See change: rework-flows-plugin-for-new-pi-flows;
 * stop-flows-edit-mode-project-writes (D2).
 */

import { ToggleField, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const URL = "/api/plugins/flows/edit-mode-default";

/** Stored plugin config. `editFlow` is LEGACY: migrated once to the global pi settings, then removed. */
export interface FlowsPluginConfig {
  /** @deprecated Ignored; see `flows.editFlow` in `~/.pi/agent/settings.json`. */
  editFlow?: boolean;
}

export function FlowsSettings(): React.ReactElement {
  const t = useT();

  const [base, setBase] = useState<boolean>(false);
  const [editFlow, setEditFlow] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isDirty = editFlow !== base;

  // Load the global value once; a parse error is shown, not overwritten.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(URL);
        if (!r.ok) return;
        const body = (await r.json()) as { enabled?: unknown; parseError?: unknown };
        if (cancelled) return;
        const v = body.enabled === true;
        setBase(v);
        setEditFlow(v);
        setError(typeof body.parseError === "string" ? body.parseError : null);
      } catch {
        /* keep the default (off) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const valuesRef = useRef(editFlow);
  valuesRef.current = editFlow;
  const baseRef = useRef(base);
  baseRef.current = base;

  const commit = useCallback(async () => {
    const enabled = valuesRef.current;
    const r = await fetch(URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { parseError?: unknown; error?: unknown };
      const msg = typeof body.parseError === "string" ? body.parseError : typeof body.error === "string" ? body.error : `HTTP ${r.status}`;
      setError(msg);
      throw new Error(msg);
    }
    setError(null);
    setBase(enabled);
  }, []);
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
            {t("editModeHintPost", undefined, "and the manage-flows skill. Off by default.")}{" "}
            {t("editModeHintGlobal", undefined, "Saved to ~/.pi/agent/settings.json; project files are not changed. A project's own setting overrides it.")}
          </>
        }
        value={editFlow}
        onChange={setEditFlow}
        testIds={{ control: "flows-edit-mode-toggle" }}
      />
      {error && (
        <p role="alert" data-testid="flows-edit-mode-error" className="text-xs text-[var(--status-error)]">
          {t("editModeSaveError", { error }, `Could not save: ${error}`)}
        </p>
      )}
    </div>
  );
}
