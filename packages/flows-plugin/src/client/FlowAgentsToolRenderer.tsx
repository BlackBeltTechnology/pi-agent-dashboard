/**
 * Tool renderer for the `flow_agents` authoring tool (main-session timeline).
 *
 * Renders from the real tool contract:
 *   op:"list"  → result is a catalog array `[{ name, description, … }]`.
 *   op:"write" → result is `{ written, name, path, diagnostics[] }` /
 *                `{ written:false, error }`.
 * The agent markdown body for the "view agent file" sub-row comes from the
 * tool ARGS (`toolInput.content`), not the result.
 *
 * See change: rework-flows-plugin-for-new-pi-flows.
 */
import React, { useState } from "react";

// A per-agent catalog entry. All fields optional/duck-typed: pi-flows may add
// or drop fields, and text-parsed entries nest `architect.use_when`. The
// renderer renders whatever is present. See change: flow-agents-readable-list.
interface AgentListEntry {
  name?: string;
  description?: string;
  source_type?: string;
  source_path?: string;
  tools?: string[];
  inputs?: string[];
  outputs?: Array<string | { name?: string }>;
  use_when?: string;
  architect?: { use_when?: string };
}
interface AgentWriteResult {
  written?: boolean;
  name?: string;
  path?: string;
  diagnostics?: Array<{ message?: string } | string>;
  error?: string;
}

function diagText(d: { message?: string } | string): string {
  return typeof d === "string" ? d : (d.message ?? JSON.stringify(d));
}

// Display truncation marker prepended by the host when a tool result exceeds
// the line cap (see client event-reducer TRUNCATION_MARKER_PREFIX). Matched as
// the full header so a raw result that merely starts with "«" is not misread.
const TRUNCATION_MARKER_RE = /^«\d+ earlier lines hidden»\n/;

function normalizeEntry(e: AgentListEntry): AgentListEntry {
  return { ...e, use_when: e.use_when ?? e.architect?.use_when ?? e.description };
}

function outputNames(outputs: AgentListEntry["outputs"]): string[] {
  if (!Array.isArray(outputs)) return [];
  return outputs
    .map((o) => (typeof o === "string" ? o : o?.name))
    .filter((n): n is string => typeof n === "string");
}

/**
 * Derive the `op:"list"` catalog entries from the most authoritative
 * non-truncated source. Fallback order (design Decision 2):
 *   1. `toolDetails.agents` structured catalog (never line-truncated),
 *   2. valid-JSON parse of the `result` text,
 *   3. truncation-marker guard → entries empty, truncated:true (never report 0),
 *   4. genuine empty array → 0 agents.
 * `count` is carried through so a details count survives even when entries are
 * not enumerable.
 */
function deriveListCatalog(
  result: string | undefined,
  toolDetails: unknown,
): { entries: AgentListEntry[]; truncated: boolean; count?: number } {
  // 1. toolDetails.agents (duck-typed; pi-flows may not emit it on older builds)
  const td = toolDetails as { agents?: unknown; count?: unknown } | AgentListEntry[] | undefined;
  const detailsAgents = Array.isArray(td) ? td : (td && typeof td === "object" ? td.agents : undefined);
  if (Array.isArray(detailsAgents) && detailsAgents.length > 0) {
    const entries = (detailsAgents as AgentListEntry[]).map(normalizeEntry);
    return { entries, truncated: false, count: entries.length };
  }
  const detailsCount =
    td && typeof td === "object" && !Array.isArray(td) && typeof td.count === "number"
      ? td.count
      : undefined;

  // 3. truncation-marker guard (before parse: the marker is never valid JSON)
  if (typeof result === "string" && TRUNCATION_MARKER_RE.test(result)) {
    return { entries: [], truncated: true, count: detailsCount };
  }

  // 2. valid-JSON parse of the (untruncated) result text
  let parsed: unknown = null;
  try { if (result) parsed = JSON.parse(result); } catch { parsed = null; }
  const catalog = Array.isArray(parsed) ? (parsed as AgentListEntry[]) : [];
  const entries = catalog
    .filter((a) => typeof a?.name === "string")
    .map(normalizeEntry);
  return { entries, truncated: false, count: entries.length };
}

export function FlowAgentsToolRenderer({
  toolInput,
  status,
  result,
  toolDetails,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  status?: "running" | "complete" | "error";
  result?: string;
  toolDetails?: unknown;
}) {
  const [showFile, setShowFile] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const op = toolInput.op === "write" ? "write" : "list";
  const content = typeof toolInput.content === "string" ? toolInput.content : "";

  let parsed: unknown = null;
  try { if (result) parsed = JSON.parse(result); } catch { parsed = null; }

  // ── list ──
  if (op === "list") {
    const { entries, truncated, count } = deriveListCatalog(result, toolDetails);
    const shownCount = entries.length > 0 ? entries.length : (typeof count === "number" ? count : 0);
    const toggle = (name: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name); else next.add(name);
        return next;
      });
    return (
      <div className="border border-[var(--border-primary)] rounded-md bg-[var(--bg-secondary)] p-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-purple-400">⊙</span>
          <span className="font-semibold">flow_agents</span>
          {truncated && entries.length === 0 ? (
            <span className="text-[var(--text-muted)]">list · output truncated — expand</span>
          ) : (
            <span className="text-[var(--text-muted)]">list · {shownCount} agents</span>
          )}
        </div>
        {entries.length > 0 && (
          <div className="mt-2">
            {entries.map((a) => {
              const name = a.name ?? "";
              const isOpen = expanded.has(name);
              const detailRows: Array<[string, string]> = [];
              if (a.tools && a.tools.length > 0) detailRows.push(["tools", a.tools.join(", ")]);
              if (a.inputs && a.inputs.length > 0) detailRows.push(["inputs", a.inputs.join(", ")]);
              const outs = outputNames(a.outputs);
              if (outs.length > 0) detailRows.push(["outputs", outs.join(", ")]);
              if (a.use_when) detailRows.push(["use_when", a.use_when]);
              return (
                <div key={name} className="border-t border-[var(--border-subtle)] first:border-t-0">
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    className="flex items-baseline gap-2 w-full text-left py-1 hover:text-[var(--text-primary)]"
                  >
                    <span className="text-[var(--text-muted)] w-3 shrink-0">{isOpen ? "▾" : "▸"}</span>
                    <span className="font-mono font-semibold text-[var(--text-primary)]">{name}</span>
                    {a.description && (
                      <span className="text-[var(--text-secondary)] flex-1">{a.description}</span>
                    )}
                    {a.source_type && (
                      <span className="ml-auto shrink-0 text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-surface)] rounded px-1.5 py-0.5">
                        {a.source_type}
                      </span>
                    )}
                  </button>
                  {isOpen && detailRows.length > 0 && (
                    <div className="ml-5 mb-2 p-2 bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded">
                      {detailRows.map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-[var(--text-tertiary)] w-16 shrink-0">{k}</span>
                          <span className="font-mono text-[var(--text-secondary)]">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── write ──
  const wr = (parsed && typeof parsed === "object" ? parsed : {}) as AgentWriteResult;
  const written = wr.written === true;
  const isError = status === "error" || wr.written === false;
  const diagnostics = (wr.diagnostics ?? []).map(diagText);

  return (
    <div className="border border-[var(--border-primary)] rounded-md bg-[var(--bg-secondary)] p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-purple-400">⊙</span>
        <span className="font-semibold">flow_agents</span>
        <span className="text-[var(--text-muted)]">write</span>
        {written && wr.name && <span className="font-mono text-green-400">{wr.name}</span>}
        {written && <span className="text-[var(--text-muted)]">saved</span>}
        {isError && <span className="text-red-400">not written</span>}
      </div>

      {isError && (
        <pre className="mt-2 font-mono text-[11px] text-red-400 whitespace-pre-wrap">
          {diagnostics.length > 0 ? diagnostics.join("\n") : (wr.error ?? "Unknown error")}
        </pre>
      )}

      {content && (
        <div className="mt-2">
          <button
            onClick={() => setShowFile((v) => !v)}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-blue-400 font-mono"
          >
            {showFile ? "▾" : "▸"} View agent file {wr.path ? `· ${wr.path.split("/").pop()}` : ""}
          </button>
          {showFile && (
            <pre className="mt-1 font-mono text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded p-2 overflow-auto max-h-[260px] whitespace-pre">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
