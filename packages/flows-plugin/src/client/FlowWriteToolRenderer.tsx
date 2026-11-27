/**
 * Tool renderer for the `flow_write` authoring tool (main-session timeline).
 *
 * Renders from the real tool contract: result JSON is
 * `{ written, name, namespace, command, path, diagnostics[] }` (success) or
 * `{ written:false, diagnostics[] }` / `{ written:false, error }` (failure).
 * The result carries no parsed steps, so the graph + step/agent/code counts are
 * built client-side from the tool ARGS (`toolInput.content`) with the same
 * not-started pipeline as Open flow (`buildIdleFlowState`, lenient) and drawn
 * by the shared `FlowGraph` (expand-to-dialog, error-route toggle).
 *
 * See changes: rework-flows-plugin-for-new-pi-flows, unify-flow-rendering (D4).
 */

import { useT, useUiPrimitiveOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowState } from "../types.js";
import React, { useMemo, useState } from "react";
import { FlowGraph, flowStateToGraphSteps } from "./FlowGraph.js";
import { buildIdleFlowState } from "./flow-idle-state.js";

interface FlowWriteResult {
  written?: boolean;
  name?: string;
  namespace?: string;
  command?: string;
  path?: string;
  diagnostics?: Array<{ message?: string } | string>;
  error?: string;
}

function safeParse(result: string | undefined): FlowWriteResult | null {
  if (!result) return null;
  try { return JSON.parse(result) as FlowWriteResult; } catch { return null; }
}

/** Step counts from the built step list; agent = agent | agent-decision, code = code | code-decision. */
function stepCounts(state: FlowState): { total: number; agents: number; code: number } {
  const steps = state.dagSteps ?? [];
  const isAgent = (t: string) => t === "agent" || t === "agent-decision";
  const isCode = (t: string) => t === "code" || t === "code-decision";
  return {
    total: steps.length,
    agents: steps.filter((s) => isAgent(s.stepType)).length,
    code: steps.filter((s) => isCode(s.stepType)).length,
  };
}

function diagText(d: { message?: string } | string): string {
  return typeof d === "string" ? d : (d.message ?? JSON.stringify(d));
}

export function FlowWriteToolRenderer({
  toolInput,
  status,
  result,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  status?: "running" | "complete" | "error";
  result?: string;
}) {
  const t = useT();
  const Dialog = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.dialog);
  const [showYaml, setShowYaml] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const content = typeof toolInput.content === "string" ? toolInput.content : "";
  const parsed = safeParse(result);
  const flowName = parsed?.command ?? parsed?.name ?? "flow";
  const flowPath = parsed?.path;
  // Same pipeline as Open flow; lenient so older/incomplete persisted YAML keeps its graph.
  const flowState = useMemo(() => {
    if (!content) return null;
    const r = buildIdleFlowState(content, { name: flowName, source: flowPath }, { lenient: true });
    return r.kind === "ready" ? r.flowState : null;
  }, [content, flowName, flowPath]);
  const graphSteps = useMemo(() => (flowState ? flowStateToGraphSteps(flowState) : null), [flowState]);
  const counts = useMemo(() => (flowState ? stepCounts(flowState) : null), [flowState]);

  const diagnostics = (parsed?.diagnostics ?? []).map(diagText);
  const written = parsed?.written === true;
  const isError = status === "error" || parsed?.written === false;

  return (
    <div className="border border-[var(--border-primary)] rounded-md bg-[var(--bg-secondary)] p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-[var(--accent-blue,#0969da)]">⇆</span>
        <span className="font-semibold">flow_write</span>
        {status === "running" && <span className="text-[var(--text-muted)]">writing…</span>}
        {written && parsed?.command && (
          <span className="font-mono text-green-400">/{parsed.command}</span>
        )}
        {written && <span className="text-[var(--text-muted)]">registered</span>}
        {isError && <span className="text-red-400">not written — validation failed</span>}
      </div>

      {/* Counts built from args */}
      {written && counts && (
        <div className="mt-1 text-[var(--text-tertiary)]">
          {counts.total} steps · {counts.agents} agents, {counts.code} code
        </div>
      )}

      {/* Shared flow graph built from args */}
      {written && graphSteps && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">{t("flowGraph", undefined, "Flow graph")}</div>
          <FlowGraph steps={graphSteps} fit onExpand={Dialog ? () => setGraphOpen(true) : undefined} />
          {Dialog && (
            <Dialog open={graphOpen} onClose={() => setGraphOpen(false)} title={`Flow graph · ${flowName}`} size="full">
              <div style={{ height: "82vh", overflow: "hidden" }}>
                <FlowGraph steps={graphSteps} />
              </div>
            </Dialog>
          )}
        </div>
      )}

      {/* Validation failure — diagnostics verbatim */}
      {isError && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-red-400 mb-1">{t("result", undefined, "Result")}</div>
          <pre className="font-mono text-[11px] text-red-400 whitespace-pre-wrap">
            {diagnostics.length > 0 ? diagnostics.join("\n") : (parsed?.error ?? "Unknown error")}
          </pre>
        </div>
      )}

      {/* Non-fatal diagnostics on success */}
      {written && diagnostics.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-400">
          {diagnostics.map((d, i) => <div key={i}>⚠ {d}</div>)}
        </div>
      )}

      {/* View flow YAML (the submitted args) */}
      {content && (
        <div className="mt-2">
          <button
            onClick={() => setShowYaml((v) => !v)}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-blue-400 font-mono"
          >
            {showYaml ? "▾" : "▸"} View flow YAML {parsed?.path ? `· ${parsed.path.split("/").pop()}` : ""}
          </button>
          {showYaml && (
            <pre className="mt-1 font-mono text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded p-2 overflow-auto max-h-[260px] whitespace-pre">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
