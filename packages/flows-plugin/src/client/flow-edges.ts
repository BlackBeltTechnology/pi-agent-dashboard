/**
 * Shared flow-edge derivation. ONE rule, consumed by both the live `FlowGraph`
 * (running runs, from `dagSteps`) and the static `flow_write` Mermaid snapshot
 * (from parsed YAML), so the two views never drift on what an edge is.
 *
 * Edge classes:
 *  - `sequential` — `blockedBy` dependency
 *  - `branch`     — decision `branches` (fork / agent-decision / code-decision)
 *  - `route`      — `on_complete` / `on_error` cross-segment routing
 *  - `implicit`   — engine fall-through: segment exit → next declared segment's
 *                   entries (pi-flows `splitIntoSegments` + `segmentIndex++`)
 *
 * The function derives only the classes its input carries. Both callers pass
 * `onError`; only the static (YAML) caller can carry legacy `onComplete`.
 * An `implicit` (or in-segment `sequential`) edge and an `on_error` route on the
 * same pair are BOTH kept — success fall-through and error route are distinct.
 *
 * See change: improve-flow-ui, fix-flow-graph-engine-order.
 */

export type FlowEdgeKind = "sequential" | "branch" | "route" | "implicit";

export interface FlowEdgeStep {
  id: string;
  /** RAW engine node kind (`agent` | `fork` | `agent-decision` | `code` |
   *  `code-decision`) — never a display mapping that merges kinds. Anything
   *  outside the separator set (absent, unknown) is a DAG-segment member. */
  type?: string;
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
  /** Set only on `route` edges labeled `on_error`. `returning` = the handler's
   *  forward closure rejoins the main flow (live control flow → render as a loop
   *  arc); `terminal` = the handler is a sink that never rejoins (→ collapse into
   *  a tail sink node). Mirrors the engine, which keeps running every step
   *  reachable from an on_error target after routing to it. */
  routeTopology?: "returning" | "terminal";
}

/** Engine separator kinds: each is its own segment (pi-flows
 *  `splitIntoSegments`). Closed set — anything else joins a DAG segment. */
const SEPARATOR_KINDS = new Set(["code", "code-decision", "fork", "agent-decision"]);
/** Decisions fall through at their `max_iterations` loop cap; forks never do. */
const CAPPED_DECISION_KINDS = new Set(["code-decision", "agent-decision"]);

const isErrorRoute = (kind: FlowEdgeKind, label?: string) => kind === "route" && label === "on_error";
const isPlain = (kind: FlowEdgeKind) => kind === "sequential" || kind === "implicit";

/** Derive the canonical edge set for a flow. Pure; order-sensitive (array index
 *  defines forward/backward). Skips edges whose endpoints are not in `steps`,
 *  and collapses duplicate `{from,to}` pairs (labeled branch/route wins) —
 *  except a plain (sequential/implicit) edge and an `on_error` route, which
 *  coexist. */
export function deriveFlowEdges(steps: FlowEdgeStep[]): FlowEdge[] {
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const has = (id: string) => order.has(id);
  const edges: FlowEdge[] = [];

  const add = (from: string, to: string, kind: FlowEdgeKind, label?: string): void => {
    if (!has(from) || !has(to)) return;
    const backward = (order.get(to) ?? 0) <= (order.get(from) ?? 0);
    // A plain edge and an on_error route on the same pair stay distinct.
    const coexists = (e: FlowEdge) =>
      (isErrorRoute(kind, label) && isPlain(e.kind)) || (isPlain(kind) && isErrorRoute(e.kind, e.label));
    const existing = edges.find((e) => e.from === from && e.to === to && !coexists(e));
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

  // 4. Fall-through edges, mirroring the engine's segment program. Steps split
  //    into segments in declared order: each separator is its own segment,
  //    consecutive other steps form one DAG segment. A segment that finishes
  //    without routing runs the next declared segment, so every exit of segment
  //    i gets an `implicit` edge to every entry of segment i+1.
  addFallThrough(steps, order, add);

  // 5. on_error route topology. The engine keeps running everything reachable
  //    from an on_error target. A handler is `returning` when its forward
  //    closure rejoins the source or the source's success continuation
  //    (live control flow → loop arc); `terminal` otherwise (a sink).
  classifyRouteTopology(edges);

  return edges;
}

interface Segment {
  /** Steps that may complete without routing (fall-through sources). */
  exits: string[];
  /** Steps the segment starts with (fall-through targets). */
  entries: string[];
}

function addFallThrough(
  steps: FlowEdgeStep[],
  order: Map<string, number>,
  add: (from: string, to: string, kind: FlowEdgeKind, label?: string) => void,
): void {
  // Split into segments: separator → own segment; others group into DAGs.
  const groups: { dag: boolean; members: FlowEdgeStep[] }[] = [];
  for (const s of steps) {
    const separator = SEPARATOR_KINDS.has(s.type ?? "");
    const last = groups[groups.length - 1];
    if (!separator && last?.dag) last.members.push(s);
    else groups.push({ dag: !separator, members: [s] });
  }

  const segments: Segment[] = groups.map(({ dag, members }) => {
    if (!dag) {
      const s = members[0];
      const branchTargets = Object.values(s.branches ?? {});
      const own = order.get(s.id) ?? 0;
      const fallsThrough =
        branchTargets.length === 0 ||
        (CAPPED_DECISION_KINDS.has(s.type ?? "") &&
          branchTargets.some((t) => order.has(t) && (order.get(t) ?? 0) <= own));
      return { exits: fallsThrough ? [s.id] : [], entries: [s.id] };
    }
    // DAG segment: in-segment blockedBy + in-segment on_error source→target.
    const ids = new Set(members.map((m) => m.id));
    const deps = new Map<string, Set<string>>(members.map((m) => [m.id, new Set<string>()]));
    for (const m of members) {
      for (const dep of m.blockedBy) if (ids.has(dep) && dep !== m.id) deps.get(m.id)?.add(dep);
      if (m.onError && ids.has(m.onError) && m.onError !== m.id) {
        deps.get(m.onError)?.add(m.id);
        // The engine runs every DAG step: the target also runs after a success.
        add(m.id, m.onError, "sequential");
      }
    }
    const dependedOn = new Set<string>();
    for (const d of deps.values()) for (const id of d) dependedOn.add(id);
    return {
      entries: members.filter((m) => deps.get(m.id)?.size === 0).map((m) => m.id),
      exits: members.filter((m) => !dependedOn.has(m.id)).map((m) => m.id),
    };
  });

  for (let i = 0; i + 1 < segments.length; i++) {
    for (const from of segments[i].exits) {
      for (const to of segments[i + 1].entries) add(from, to, "implicit");
    }
  }
}

/** Tag each `on_error` route edge with `routeTopology`. Pure: reachability over
 *  the flow edges EXCLUDING on_error routes (those are what we classify). A
 *  handler is `returning` when its forward closure reaches the route source or
 *  any node on the source's success continuation; else `terminal`. */
function classifyRouteTopology(edges: FlowEdge[]): void {
  const errorRoutes = edges.filter((e) => e.kind === "route" && e.label === "on_error");
  if (errorRoutes.length === 0) return;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === "route" && e.label === "on_error") continue; // exclude the edges under test
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }

  const cache = new Map<string, Set<string>>();
  const reach = (start: string): Set<string> => {
    const cached = cache.get(start);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop() as string;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of adj.get(n) ?? []) stack.push(m);
    }
    cache.set(start, seen);
    return seen;
  };

  for (const e of errorRoutes) {
    const fromClosure = reach(e.from); // source + its success continuation
    const handlerClosure = reach(e.to); // handler + its forward closure
    let returning = false;
    for (const n of handlerClosure) {
      if (n !== e.to && (n === e.from || fromClosure.has(n))) {
        returning = true;
        break;
      }
    }
    e.routeTopology = returning ? "returning" : "terminal";
  }
}
