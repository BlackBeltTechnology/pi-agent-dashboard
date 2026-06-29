/**
 * Shared flow-edge derivation. ONE rule, consumed by both the live `FlowGraph`
 * (running runs, from `dagSteps`) and the static `flow_write` Mermaid snapshot
 * (from parsed YAML), so the two views never drift on what an edge is.
 *
 * Edge classes:
 *  - `sequential` — `blockedBy` dependency
 *  - `branch`     — decision `branches` (fork / agent-decision / code-decision)
 *  - `route`      — `on_complete` / `on_error` cross-segment routing
 *  - `implicit`   — a step after a separator with no `blockedBy` (segment fall-through)
 *
 * The function derives only the classes its input carries: the live caller
 * passes `branches` but not `onComplete`/`onError` (pi-flows omits those from
 * `flow:flow-started`), so `route` edges appear only in the static caller.
 *
 * See change: improve-flow-ui.
 */

export type FlowEdgeKind = "sequential" | "branch" | "route" | "implicit";

export interface FlowEdgeStep {
  id: string;
  /** Node kind (`agent` | `fork` | `agent-decision` | `code` | `code-decision`). */
  type: string;
  blockedBy: string[];
  /** Decision branch label → target step id. */
  branches?: Record<string, string>;
  onComplete?: string;
  onError?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  kind: FlowEdgeKind;
  /** Target declared at or before the source → render as backward/loop edge. */
  backward: boolean;
}

/** Derive the canonical edge set for a flow. Pure; order-sensitive (array index
 *  defines forward/backward). Skips edges whose endpoints are not in `steps`,
 *  and collapses duplicate `{from,to}` pairs (labeled branch/route wins). */
export function deriveFlowEdges(steps: FlowEdgeStep[]): FlowEdge[] {
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const has = (id: string) => order.has(id);
  const edges: FlowEdge[] = [];

  const add = (from: string, to: string, kind: FlowEdgeKind, label?: string): void => {
    if (!has(from) || !has(to)) return;
    const backward = (order.get(to) ?? 0) <= (order.get(from) ?? 0);
    const existing = edges.find((e) => e.from === from && e.to === to);
    if (existing) {
      // De-dup: prefer the labeled branch/route classification over a plain
      // sequential/implicit edge for the same pair.
      const labeled = kind === "branch" || kind === "route";
      const existingLabeled = existing.kind === "branch" || existing.kind === "route";
      if (labeled && !existingLabeled) {
        existing.kind = kind;
        existing.label = label;
        existing.backward = backward;
      }
      return;
    }
    edges.push({ from, to, kind, label, backward });
  };

  // 1. Sequential edges (blockedBy).
  for (const s of steps) {
    for (const dep of s.blockedBy) add(dep, s.id, "sequential");
  }

  // 2. Decision-branch edges.
  for (const s of steps) {
    if (!s.branches) continue;
    for (const [label, target] of Object.entries(s.branches)) {
      add(s.id, target, "branch", label);
    }
  }

  // 3. Routing edges (on_complete / on_error).
  for (const s of steps) {
    if (s.onComplete) add(s.id, s.onComplete, "route", "on_complete");
    if (s.onError) add(s.id, s.onError, "route", "on_error");
  }

  // 4. Implicit-segment edges: a step with no blockedBy AND no incoming edge
  //    (sequential/branch/route) falls through from the immediately preceding
  //    step — the segment separator or agent that ran before it.
  const incoming = new Set(edges.map((e) => e.to));
  for (let i = 1; i < steps.length; i++) {
    const curr = steps[i];
    if (curr.blockedBy.length > 0 || incoming.has(curr.id)) continue;
    add(steps[i - 1].id, curr.id, "implicit");
    incoming.add(curr.id);
  }

  return edges;
}
