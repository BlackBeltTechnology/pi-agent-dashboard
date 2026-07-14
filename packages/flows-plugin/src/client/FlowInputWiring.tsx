/**
 * Input-wiring editor for the `flows.run` automation action.
 *
 * Claimed into the automation-plugin's `automation-action-editor` slot
 * (keyed by `config.actionId: "flows.run"`). The create-automation dialog
 * renders it additively below the generic flow + task form.
 *
 * Reads the selected flow's declared `inputs:` schema read-only from
 * `GET /api/plugins/flows/flow-inputs?cwd=&flow=` and renders one wiring row
 * per declared input. Each row binds either a typed literal or the trigger's
 * fired value (`${{trigger}}`). Writes ONLY `payload.inputs` back via
 * `onChange`; never writes a `flow.yaml`.
 *
 * UX: collapsible disclosure, collapsed by default (only flow + task surface
 * initially). Auto-expands when a required input is unbound so a run is never
 * silently blocked.
 *
 * See change: wire-flow-inputs-in-automation.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/** The canonical trigger-binding token (mirrors pi-flows `${{…}}` syntax). */
const TRIGGER_TOKEN = "${{trigger}}";

type FlowInputType = "string" | "number" | "boolean" | "object" | "array";
interface FlowInputField {
  name: string;
  type: FlowInputType;
  required: boolean;
}

export interface FlowInputWiringProps {
  /** Current action payload. `payload.flow` selects the flow; `payload.inputs` holds wired values. */
  payload: Record<string, unknown>;
  /** Persist an updated payload (only `payload.inputs` is mutated here). */
  onChange: (payload: Record<string, unknown>) => void;
  /** Run cwd — scopes the read-only flow-inputs discovery. */
  cwd?: string;
}

/** Read `payload.inputs` as a plain object (else `{}`). */
function readInputs(payload: Record<string, unknown>): Record<string, unknown> {
  const inp = payload.inputs;
  return inp && typeof inp === "object" && !Array.isArray(inp)
    ? { ...(inp as Record<string, unknown>) }
    : {};
}

/** Coerce a raw string literal to the input's declared type (D4). */
function coerceLiteral(raw: string, type: FlowInputType): unknown {
  switch (type) {
    case "number": {
      if (raw.trim() === "") return "";
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case "boolean":
      return raw === "true";
    case "object":
    case "array":
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

/** A value is "unbound" when absent or an empty string literal. */
function isUnbound(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

export function FlowInputWiring({ payload, onChange, cwd }: FlowInputWiringProps): React.ReactElement | null {
  const t = useT();
  const flow = typeof payload.flow === "string" ? payload.flow : "";
  const [fields, setFields] = useState<FlowInputField[]>([]);
  const [loading, setLoading] = useState(false);
  // `null` = follow the auto-expand heuristic; a boolean = the user's choice.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  const inputs = readInputs(payload);
  // Keep the latest payload/onChange in a ref so the fetch effect can prune
  // orphan keys without listing them as deps (avoids a re-fetch loop).
  const latest = useRef({ payload, onChange });
  latest.current = { payload, onChange };

  useEffect(() => {
    if (!flow) {
      setFields([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ flow, ...(cwd ? { cwd } : {}) }).toString();
    fetch(`/api/plugins/flows/flow-inputs?${qs}`)
      .then((r) => (r.ok ? r.json() : { inputs: [] }))
      .then((data: { inputs?: FlowInputField[] }) => {
        if (cancelled) return;
        const next = Array.isArray(data.inputs) ? data.inputs : [];
        setFields(next);
        // Drop wired keys the new flow no longer declares (6.4), with a warning.
        const declared = new Set(next.map((f) => f.name));
        const cur = readInputs(latest.current.payload);
        const dropped = Object.keys(cur).filter((k) => !declared.has(k));
        if (dropped.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[flows] dropping orphan wired inputs not declared by ${flow}: ${dropped.join(", ")}`);
          const pruned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(cur)) if (declared.has(k)) pruned[k] = v;
          latest.current.onChange({ ...latest.current.payload, inputs: pruned });
        }
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flow, cwd]);

  const boundCount = useMemo(
    () => fields.filter((f) => inputs[f.name] === TRIGGER_TOKEN).length,
    [fields, inputs],
  );
  const requiredUnbound = fields.some((f) => f.required && isUnbound(inputs[f.name]));
  const open = openOverride ?? requiredUnbound;

  function setInput(name: string, value: unknown): void {
    const next = readInputs(payload);
    if (value === "" || value === undefined) delete next[name];
    else next[name] = value;
    onChange({ ...payload, inputs: next });
  }

  if (!flow || (fields.length === 0 && !loading)) return null;

  return (
    <details
      className="mt-2 border-t border-[var(--border-secondary)] pt-2"
      open={open}
      onToggle={(e) => setOpenOverride((e.currentTarget as HTMLDetailsElement).open)}
      data-testid="flow-input-wiring"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>{t("inputs", undefined, "Inputs")}</span>
        <span className="rounded-full border border-[var(--border-secondary)] px-1.5 text-[9px] font-mono text-[var(--text-muted)]">
          {fields.length}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-[var(--text-muted)]" data-testid="flow-input-wiring-hint">
          from {flow}
          {boundCount > 0 ? ` · ${boundCount} bound to trigger` : ""}
        </span>
      </summary>

      <div className="mt-2 space-y-2" data-testid="flow-input-wiring-rows">
        {fields.map((f) => {
          const raw = inputs[f.name];
          const boundToTrigger = raw === TRIGGER_TOKEN;
          return (
            <label key={f.name} className="block text-xs text-[var(--text-secondary)]">
              <span className="mb-0.5 block">
                {f.name}
                <span className="ml-1.5 font-mono text-[9px] text-[var(--text-muted)]">{f.type}</span>
                {f.required && <span className="text-[var(--danger,#ef4444)]"> *</span>}
              </span>
              <div className="flex items-stretch gap-1.5">
                <div className="inline-flex overflow-hidden rounded border border-[var(--border-secondary)]">
                  <button
                    type="button"
                    data-testid={`flow-input-${f.name}-mode-literal`}
                    onClick={() => setInput(f.name, f.type === "boolean" ? false : "")}
                    className={`px-2 text-[10px] ${
                      boundToTrigger
                        ? "text-[var(--text-secondary)]"
                        : "bg-[var(--accent,#6366f1)] text-white"
                    }`}
                  >
                    literal
                  </button>
                  <button
                    type="button"
                    data-testid={`flow-input-${f.name}-mode-trigger`}
                    onClick={() => setInput(f.name, TRIGGER_TOKEN)}
                    className={`border-l border-[var(--border-secondary)] px-2 text-[10px] ${
                      boundToTrigger
                        ? "bg-[var(--accent,#6366f1)] text-white"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    trigger
                  </button>
                </div>
                {boundToTrigger ? (
                  <span
                    className="flex flex-1 items-center rounded border border-[#0d425c] bg-[#06283a] px-2 font-mono text-[11.5px] text-[var(--cyan,#22d3ee)]"
                    data-testid={`flow-input-${f.name}-trigger`}
                  >
                    {TRIGGER_TOKEN} · the file that fired
                  </span>
                ) : f.type === "boolean" ? (
                  <select
                    value={raw === true ? "true" : "false"}
                    onChange={(e) => setInput(f.name, e.target.value === "true")}
                    data-testid={`flow-input-${f.name}`}
                    className="input flex-1"
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={raw == null ? "" : String(raw)}
                    onChange={(e) => setInput(f.name, coerceLiteral(e.target.value, f.type))}
                    placeholder={f.type === "object" || f.type === "array" ? "JSON" : ""}
                    data-testid={`flow-input-${f.name}`}
                    className="input flex-1 font-mono"
                  />
                )}
              </div>
            </label>
          );
        })}
        <p className="text-[9.5px] text-[var(--text-muted)]">
          Bind <b>trigger</b> to pass the fired file path · <b>literal</b> for a fixed typed value · leave an optional
          input blank to skip it.
        </p>
      </div>
    </details>
  );
}

/** Slot-claim export referenced by the flows-plugin manifest. */
export const FlowInputWiringClaim = FlowInputWiring;
