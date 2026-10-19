/**
 * ProjectSettings — the "Project settings…" panel of a Pi-global server row on
 * the folder page. Writes only a project override (`enabled`, `exposure`) to
 * `<cwd>/.pi/mcp.json`: Inherit / On / Off as a native radiogroup (arrow keys),
 * an exposure select whose first option is "Inherit (<global value>)", and the
 * override's `toolExposure` read-only (shown and preserved, never edited).
 * Below 640px the panel is a bottom sheet; every action keeps a 44px hit area.
 *
 * See change: mcp-client-project-overrides (D9).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { displayExposure, MCP_EXPOSURES } from "../core/pi-rules.js";
import type { EffectiveServerView, Scope } from "../core/types.js";
import { ApiError, scopeToWire, setProjectOverride } from "./api.js";
import { invalidateEffective } from "./hooks.js";

type EnabledChoice = "inherit" | "on" | "off";

export interface ProjectSettingsPanelProps {
  /** The Pi-global row (carries `projectOverride` when the folder already overrides it). */
  server: EffectiveServerView;
  scope: Extract<Scope, { kind: "project" }>;
  narrow: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function enabledChoiceOf(raw: Record<string, unknown>): EnabledChoice {
  if (raw.enabled === undefined) return "inherit";
  return raw.enabled === false ? "off" : "on";
}

export function ProjectSettingsPanel({ server, scope, narrow, onClose, onSaved }: ProjectSettingsPanelProps): React.ReactElement {
  const t = useT();
  const { name } = server;
  const raw = server.projectOverride?.raw ?? {};
  const inheritedEnabled = server.projectOverride?.inherited.enabled ?? server.enabled;
  const inheritedExposure = server.projectOverride?.inherited.exposure ?? server.exposure;

  const initialEnabled = enabledChoiceOf(raw);
  const initialExposure = raw.exposure === undefined ? "inherit" : displayExposure(raw.exposure);
  const [enabled, setEnabled] = useState<EnabledChoice>(initialEnabled);
  const [exposure, setExposure] = useState<string>(initialExposure);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkedRef = useRef<HTMLInputElement>(null);
  // Focus goes to the CHECKED radio, not the first option.
  useEffect(() => checkedRef.current?.focus(), []);

  const toolExposure =
    raw.toolExposure !== null && typeof raw.toolExposure === "object" && !Array.isArray(raw.toolExposure)
      ? Object.entries(raw.toolExposure as Record<string, unknown>)
      : [];

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await setProjectOverride(
        name,
        {
          enabled: enabled === "inherit" ? null : enabled === "on",
          // An untouched exposure keeps the file's own literal (a legacy alias stays an alias).
          exposure:
            exposure === initialExposure ? ((raw.exposure as string | undefined) ?? null) : exposure === "inherit" ? null : exposure,
        },
        scopeToWire(scope),
      );
      invalidateEffective(scope.cwd);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const enabledLabel = t("mcpProjectEnabledLabel", undefined, "Enabled in this folder");
  const choices: Array<{ value: EnabledChoice; label: string }> = [
    { value: "inherit", label: `Inherit (${inheritedEnabled ? "on" : "off"})` },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ];

  return (
    <div className={`fixed inset-0 z-50 flex ${narrow ? "items-end" : "items-center"} justify-center`}>
      <button
        type="button"
        aria-label={t("mcpProjectClose", undefined, "Close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[var(--bg-overlay,rgba(0,0,0,0.5))]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`mcp-project-panel-title-${name}`}
        data-testid="mcp-folder-project-panel"
        data-sheet={narrow ? "bottom" : "dialog"}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className={`relative w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-secondary)] p-4 space-y-3 ${
          narrow ? "rounded-t-xl" : "rounded-lg"
        }`}
      >
        <div>
          <h2 id={`mcp-project-panel-title-${name}`} className="text-sm font-semibold m-0 text-[var(--text-primary)]">
            {t("mcpProjectSettingsTitle", { name }, `Project settings: ${name}`)}
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)] m-0">
            {t(
              "mcpProjectSettingsHint",
              undefined,
              "Changes only this folder. Writes .pi/mcp.json; the Pi global entry and its credentials are kept.",
            )}
          </p>
        </div>

        <fieldset className="border-0 p-0 m-0">
          <legend className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">{enabledLabel}</legend>
          <div role="radiogroup" aria-label={enabledLabel} className="flex gap-1">
            {choices.map((c) => (
              <label
                key={c.value}
                className={`inline-flex items-center gap-1.5 px-2 min-h-11 sm:min-h-0 sm:py-1 rounded border text-[12px] ${
                  enabled === c.value
                    ? "border-[var(--accent-primary,#60a5fa)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                    : "border-[var(--border-secondary)] text-[var(--text-secondary)]"
                }`}
              >
                <input
                  ref={enabled === c.value ? checkedRef : undefined}
                  type="radio"
                  name={`mcp-project-enabled-${name}`}
                  value={c.value}
                  checked={enabled === c.value}
                  onChange={() => setEnabled(c.value)}
                  data-testid={`mcp-project-enabled-${c.value}`}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] m-0 mt-1">
            Inherit follows Pi global, including later changes there.
          </p>
        </fieldset>

        <div>
          <label htmlFor={`mcp-project-exposure-${name}`} className="block text-[12px] font-semibold text-[var(--text-primary)] mb-1">
            Exposure in this folder
          </label>
          <select
            id={`mcp-project-exposure-${name}`}
            data-testid="mcp-project-exposure"
            value={exposure}
            onChange={(e) => setExposure(e.target.value)}
            className="w-full min-h-11 sm:min-h-0 px-2 py-1 text-[12px] rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary,transparent)] text-[var(--text-primary)]"
          >
            <option value="inherit">{`Inherit (${inheritedExposure})`}</option>
            {MCP_EXPOSURES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        {toolExposure.length > 0 && (
          <div data-testid="mcp-project-tool-exposure">
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">Per-tool exposure (read-only)</div>
            <p className="text-[11px] text-[var(--text-secondary)] m-0">
              {toolExposure.map(([tool, v]) => (
                <span key={tool} className="mr-2">
                  <code>{tool}</code> → {String(v)}
                </span>
              ))}
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)] m-0">
              Kept as is. Edit in <code>.pi/mcp.json</code> or pi's <code>/mcp</code>.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" data-testid="mcp-project-error" className="text-[11px] text-[var(--status-error,#f87171)] m-0">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            data-testid="mcp-project-cancel"
            className="px-3 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[12px] text-[var(--text-secondary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            data-testid="mcp-project-save"
            className="px-3 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded text-[12px] bg-[var(--accent-solid)] text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
