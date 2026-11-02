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
 *
 * Advanced group: the flow catalog timings (plugin config, `catalog-timings.ts`).
 * An out-of-range value rejects the save with a message naming the range and
 * leaves the stored value unchanged; a saved value applies without restart.
 * See change: flows-dock-chip-and-panel-actions (D11).
 */

import { NumberField, SettingsGroup, ToggleField, usePluginConfig, usePluginSend, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG_TIMING_SPECS, type CatalogTimingKey, type CatalogTimingSpec, rangeLabel as rangeText, validateTiming } from "../catalog-timings.js";

const TIMING_LABELS: Record<CatalogTimingKey, [key: string, fallback: string]> = {
  catalogAskLimitSec: ["catalogAskLimitLabel", "Catalog ask limit per session"],
  catalogReaskIntervalSec: ["catalogReaskIntervalLabel", "Re-ask interval while unknown"],
  catalogReaskAttempts: ["catalogReaskAttemptsLabel", "Re-ask attempts per view"],
  catalogServerStartIntervalSec: ["catalogServerStartIntervalLabel", "Re-ask interval after server start"],
  catalogServerStartWindowSec: ["catalogServerStartWindowLabel", "Re-ask window after server start"],
};

type TimingEdits = Partial<Record<CatalogTimingKey, number>>;

const URL = "/api/plugins/flows/edit-mode-default";

/** Stored plugin config. `editFlow` is LEGACY: migrated once to the global pi settings, then removed. */
export interface FlowsPluginConfig extends Partial<Record<CatalogTimingKey, number>> {
  /** @deprecated Ignored; see `flows.editFlow` in `~/.pi/agent/settings.json`. */
  editFlow?: boolean;
}

function storedTiming(config: FlowsPluginConfig, spec: CatalogTimingSpec): number {
  const v = config[spec.key];
  return validateTiming(spec, v) === null ? (v as number) : spec.default;
}

export function FlowsSettings(): React.ReactElement {
  const t = useT();
  const config = usePluginConfig<FlowsPluginConfig>();
  const send = usePluginSend();

  const [base, setBase] = useState<boolean>(false);
  const [editFlow, setEditFlow] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [timingEdits, setTimingEdits] = useState<TimingEdits>({});
  const [timingErrors, setTimingErrors] = useState<Partial<Record<CatalogTimingKey, string>>>({});
  const changedTimings: TimingEdits = {};
  for (const spec of CATALOG_TIMING_SPECS) {
    const v = timingEdits[spec.key];
    if (v !== undefined && !Object.is(v, storedTiming(config, spec))) changedTimings[spec.key] = v;
  }
  const editFlowDirty = editFlow !== base;
  const isDirty = editFlowDirty || Object.keys(changedTimings).length > 0;

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
  const timingsRef = useRef(changedTimings);
  timingsRef.current = changedTimings;

  const commit = useCallback(async () => {
    // Validate every changed timing first: an out-of-range value rejects the
    // whole save (stored values unchanged) with a message naming the range.
    const timings = timingsRef.current;
    const errs: Partial<Record<CatalogTimingKey, string>> = {};
    for (const spec of CATALOG_TIMING_SPECS) {
      if (!(spec.key in timings)) continue;
      const range = validateTiming(spec, timings[spec.key]);
      if (range) errs[spec.key] = t("timingRangeError", { range }, `Enter a value in ${range}.`);
    }
    setTimingErrors(errs);
    const firstErr = Object.values(errs)[0];
    if (firstErr) throw new Error(firstErr);
    if (Object.keys(timings).length > 0) {
      await send({ type: "plugin_config_write", id: "flows", config: timings });
      setTimingEdits({});
    }
    const enabled = valuesRef.current;
    if (enabled === baseRef.current) return;
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
  }, [send, t]);
  const reset = useCallback(() => {
    setEditFlow(baseRef.current);
    setTimingEdits({});
    setTimingErrors({});
  }, []);
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
      <SettingsGroup title={t("advancedGroup", undefined, "Advanced")} defaultOpen={Object.values(timingErrors).some(Boolean)} testId="flows-advanced-group">
        <p className="text-xs text-[var(--text-secondary)]">
          {t("catalogTimingsIntro", undefined, "How the dashboard asks sessions for their flow list.")}
        </p>
        {CATALOG_TIMING_SPECS.map((spec) => {
          const [key, fallback] = TIMING_LABELS[spec.key];
          const value = timingEdits[spec.key] ?? storedTiming(config, spec);
          return (
            <NumberField
              key={spec.key}
              label={t(key, undefined, fallback)}
              unit={spec.unit || undefined}
              hint={t("timingRangeHint", { range: rangeText(spec), def: spec.default }, `${rangeText(spec)}, default ${spec.default}`)}
              value={value}
              decimal={!spec.integer}
              allowEmpty
              step={spec.integer ? 1 : "any"}
              error={timingErrors[spec.key]}
              onChange={(v) => {
                setTimingEdits((prev) => ({ ...prev, [spec.key]: v }));
                setTimingErrors((prev) => ({ ...prev, [spec.key]: undefined }));
              }}
              testIds={{ control: `flows-timing-${spec.key}` }}
            />
          );
        })}
      </SettingsGroup>
    </div>
  );
}
