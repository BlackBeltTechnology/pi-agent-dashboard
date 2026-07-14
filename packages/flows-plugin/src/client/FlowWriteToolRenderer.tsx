/**
 * Tool renderer for the `flow_write` authoring tool (main-session timeline).
 *
 * Renders from the real tool contract: result JSON is
 * `{ written, name, namespace, command, path, diagnostics[] }` (success) or
 * `{ written:false, diagnostics[] }` / `{ written:false, error }` (failure).
 * The result carries no parsed steps, so the Mermaid snapshot + step/agent/code
 * counts are parsed client-side from the tool ARGS (`toolInput.content`).
 *
 * See change: rework-flows-plugin-for-new-pi-flows.
 */

import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import React, { useMemo, useState } from "react";
import { flowToMermaid, parseFlowYaml } from "./flow-yaml-parse.js";

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
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const [showYaml, setShowYaml] = useState(false);

  const content = typeof toolInput.content === "string" ? toolInput.content : "";
  const parsed = safeParse(result);
  const flow = useMemo(() => (content ? parseFlowYaml(content) : null), [content]);
  const mermaidMd = useMemo(
    () => (flow ? "```mermaid\n" + flowToMermaid(flow) + "\n```" : null),
    [flow],
  );

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

      {/* Counts parsed from args */}
      {written && flow && (
        <div className="mt-1 text-[var(--text-tertiary)]">
          {flow.counts.total} steps · {flow.counts.agents} agents, {flow.counts.code} code
        </div>
      )}

      {/* Mermaid snapshot from args */}
      {written && mermaidMd && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">{t("flowGraph", undefined, "Flow graph")}</div>
          <MarkdownContent content={mermaidMd} />
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
