/**
 * Shallow client-side parser for a flow YAML document, used by the
 * `flow_write` tool renderer to build a Mermaid snapshot + step/agent/code
 * counts from the tool ARGS (the submitted `content`). The tool result
 * carries no parsed steps, so we parse the args here.
 *
 * Intentionally shallow + graceful: it extracts only what the snapshot needs
 * (id, type, blockedBy, branches) and returns null on any parse failure so the
 * renderer degrades to the plain success state without erroring.
 *
 * See change: rework-flows-plugin-for-new-pi-flows.
 */
import { parse as parseYaml } from "yaml";
import { deriveFlowEdges, type FlowEdgeStep } from "./flow-edges.js";

export interface ParsedFlowStep {
  id: string;
  /** Node kind from the flow `type:` field (agent | code | code-decision | …). */
  type: string;
  blockedBy: string[];
  /** Decision branch label → target step id (code-decision / agent-decision). */
  branches?: Record<string, string>;
  onComplete?: string;
  onError?: string;
}

export interface ParsedFlow {
  name?: string;
  steps: ParsedFlowStep[];
  counts: { total: number; agents: number; code: number };
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

/** Parse a flow YAML string into a shallow step model. Returns null on failure. */
export function parseFlowYaml(content: string): ParsedFlow | null {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const root = doc as Record<string, unknown>;
  const rawSteps = root.steps;
  if (!Array.isArray(rawSteps)) return null;

  const steps: ParsedFlowStep[] = [];
  for (const rs of rawSteps) {
    if (!rs || typeof rs !== "object") continue;
    const s = rs as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id : undefined;
    if (!id) continue;
    const type = typeof s.type === "string" ? s.type : "agent";
    const branchesRaw = s.branches;
    let branches: Record<string, string> | undefined;
    if (branchesRaw && typeof branchesRaw === "object" && !Array.isArray(branchesRaw)) {
      branches = {};
      for (const [k, v] of Object.entries(branchesRaw as Record<string, unknown>)) {
        if (typeof v === "string") branches[k] = v;
      }
    }
    steps.push({
      id,
      type,
      blockedBy: asStringArray(s.blockedBy),
      branches,
      onComplete: typeof s.on_complete === "string" ? s.on_complete : undefined,
      onError: typeof s.on_error === "string" ? s.on_error : undefined,
    });
  }
  if (steps.length === 0) return null;

  const agents = steps.filter((s) => s.type === "agent" || s.type === "agent-decision").length;
  const code = steps.filter((s) => s.type === "code" || s.type === "code-decision").length;

  return {
    name: typeof root.name === "string" ? root.name : undefined,
    steps,
    counts: { total: steps.length, agents, code },
  };
}

/** Mermaid node shape per node type, mirroring the live FlowGraph glyphs. */
function nodeShape(type: string, id: string, label: string): string {
  switch (type) {
    case "code": return `${id}[["⌗ ${label}"]]`;
    case "code-decision": return `${id}{"◈ ${label}"}`;
    case "agent-decision":
    case "fork": return `${id}{"◇ ${label}"}`;
    default: return `${id}(["${label}"])`;
  }
}

/** Build a `graph LR` Mermaid string from a parsed flow. Edges come from the
 *  shared `deriveFlowEdges` (blockedBy + branches + on_complete/on_error +
 *  implicit-segment), so the snapshot matches the live FlowGraph. Backward
 *  edges (loops) render dashed. See change: improve-flow-ui. */
export function flowToMermaid(flow: ParsedFlow): string {
  const lines: string[] = ["graph LR"];
  for (const s of flow.steps) {
    lines.push(`  ${nodeShape(s.type, s.id, s.id)}`);
  }
  const edges = deriveFlowEdges(
    flow.steps.map((s): FlowEdgeStep => ({
      id: s.id,
      type: s.type,
      blockedBy: s.blockedBy,
      branches: s.branches,
      onComplete: s.onComplete,
      onError: s.onError,
    })),
  );
  for (const e of edges) {
    if (e.backward) {
      lines.push(`  ${e.from} -. "${e.label ?? ""} ↺" .-> ${e.to}`);
    } else if (e.label) {
      lines.push(`  ${e.from} -->|${e.label}| ${e.to}`);
    } else {
      lines.push(`  ${e.from} --> ${e.to}`);
    }
  }
  return lines.join("\n");
}
