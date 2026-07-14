import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
// useZoomPan is a HOOK — it cannot go through the registry (Rules of Hooks).
// Stays as a direct import. See add-plugin-ui-primitive-registry Decision 4.
import { useZoomPan } from "@blackbelt-technology/pi-dashboard-client-utils/useZoomPan";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCallSplit, mdiCodeTags, mdiRobotOutline, mdiSourceBranch } from "@mdi/js";
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { FLOW_SHOW_ERROR_ROUTES_KEY, usePersistedToggle } from "./flow-collapse-storage.js";
import { deriveFlowEdges, type FlowEdge, type FlowEdgeKind, type FlowEdgeStep } from "./flow-edges.js";

/** Per-kind visual identity for graph nodes, mirroring the FlowAgentCard badges:
 *  code/code-decision = cyan, fork/agent-decision = amber, agent = green/status.
 *  `accent` drives the left stripe + icon tint; `icon` is an mdi 24-unit path.
 *  See change: improve-flow-ui. */
const KIND_VISUAL: Record<string, { icon: string; accent?: string }> = {
  code: { icon: mdiCodeTags, accent: "#22d3ee" },          // cyan-400
  "code-decision": { icon: mdiCallSplit, accent: "#22d3ee" },
  fork: { icon: mdiSourceBranch, accent: "#fbbf24" },      // amber-400 (also agent-decision)
  agent: { icon: mdiRobotOutline },                          // no accent — tinted by status
};

// ── Types ───────────────────────────────────────────────────────────

/** Step type drives the node's mdi icon + kind accent (see KIND_VISUAL):
 *  agent = robot/green, code+code-decision = cyan, fork+agent-decision = amber.
 *  Border/fill stay status-driven. */
export type FlowStepType = "agent" | "fork" | "code" | "code-decision";

/** Map flow engine stepType/nodeKind string to graph visual type.
 *  Canonical node set: agent, agent-decision, code, code-decision, fork. Dead
 *  types removed (conditional, agent-loop-decision, and the former subflow node).
 *  See change: improve-flow-ui. */
export function mapStepType(stepType: string | undefined): FlowStepType | undefined {
  switch (stepType) {
    case "fork":
    case "agent-decision": return "fork";
    case "code": return "code";
    case "code-decision": return "code-decision";
    default: return undefined; // "agent" → default styling
  }
}

export interface FlowGraphStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "error" | "blocked";
  blockedBy: string[];
  type?: FlowStepType;
  /** Decision branch label → target step id (fork / agent-decision / code-decision). */
  branches?: Record<string, string>;
  /** Success route target (`on_complete`). Present on the static preview path and,
   *  once pi-flows emits it on `flow:flow-started`, the live path (see §8). */
  onComplete?: string;
  /** Error route target (`on_error`). Drives returning-loop vs terminal-sink rendering. */
  onError?: string;
}

// ── Data converters ────────────────────────────────────────────────

/** Convert FlowState (running/completed flow) to FlowGraphStep array.
 *  Uses dagSteps when available, falls back to agents map for backward compat.
 *  Implicit-segment + branch edges are derived later by `deriveFlowEdges` in
 *  computeLayout; here we only carry `blockedBy` + `branches`. */
export function flowStateToGraphSteps(flowState: FlowState): FlowGraphStep[] {
  if (flowState.dagSteps && flowState.dagSteps.length > 0) {
    const stepStatus = new Map<string, FlowGraphStep["status"]>();
    for (const [key, agent] of flowState.agents) {
      stepStatus.set(key, agent.status);
      if (agent.stepId) stepStatus.set(agent.stepId, agent.status);
      stepStatus.set(agent.agentName, agent.status);
    }

    const allStepIds = new Set(flowState.dagSteps.map(s => s.id));
    return flowState.dagSteps.map(step => ({
      id: step.id,
      label: step.id,
      status: stepStatus.get(step.id) || stepStatus.get(step.agent || "") || "pending",
      blockedBy: step.blockedBy.filter(dep => allStepIds.has(dep)),
      type: mapStepType(step.stepType),
      branches: step.branches,
      // Forward/error routing (present once pi-flows emits it on flow:flow-started)
      // so on_complete-wired flows draw `route` edges live. See change:
      // fix-flow-ui-graph-zoom-summary.
      onComplete: step.onComplete,
      onError: step.onError,
    }));
  }

  // Fallback: build from agents map (backward compat for old events without dagSteps)
  const stepToAgent = new Map<string, string>();
  for (const agent of flowState.agents.values()) {
    if (agent.stepId) stepToAgent.set(agent.stepId, agent.agentName);
  }
  return Array.from(flowState.agents.values()).map(agent => ({
    id: agent.agentName,
    label: agent.label || agent.agentName,
    status: agent.status,
    blockedBy: agent.blockedBy
      .map(depId => stepToAgent.get(depId) || depId)
      .filter(name => flowState.agents.has(name)),
  }));
}

interface PositionedNode {
  id: string;
  label: string;
  status: FlowGraphStep["status"];
  type?: FlowStepType;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PositionedEdge {
  source: string;
  target: string;
  points: Array<{ x: number; y: number }>;
  sourceStatus: FlowGraphStep["status"];
  targetStatus: FlowGraphStep["status"];
  label?: string;
  /** Edge class for styling (sequential/branch/route/implicit). */
  kind?: FlowEdgeKind;
  /** on_error route edge. */
  isError?: boolean;
  /** Returning on_error (rejoins the flow) vs terminal (routed to the sink). */
  isReturning?: boolean;
  /** Backward target (loop): declared at/before the source. */
  isLoop?: boolean;
}

/** Collapsed tail node pooling all terminal on_error handlers (`⚠ N exits`). */
interface ErrorSink {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Handler step ids pooled into this sink (expandable). */
  handlers: string[];
}

interface LayoutResult {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Collapsed terminal-handler sink (only when error routes are shown). */
  errorSink?: ErrorSink;
  width: number;
  height: number;
}

// ── Status styling ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { border: string; fill: string; text: string }> = {
  pending:  { border: "#555",    fill: "#2a2a2a", text: "#888"    },
  running:  { border: "#eab308", fill: "#2a2800", text: "#eab308" },
  complete: { border: "#22c55e", fill: "#0a2a10", text: "#22c55e" },
  error:    { border: "#ef4444", fill: "#2a0a0a", text: "#ef4444" },
  blocked:  { border: "#f97316", fill: "#2a1a00", text: "#f97316" },
};

function getEdgeColor(sourceStatus: string, targetStatus: string): { stroke: string; animated: boolean; dashed: boolean } {
  if (sourceStatus === "complete" && targetStatus === "running") {
    return { stroke: "#eab308", animated: true, dashed: false };
  }
  if (sourceStatus === "complete" && targetStatus === "complete") {
    return { stroke: "#22c55e", animated: false, dashed: false };
  }
  if (sourceStatus === "complete") {
    return { stroke: "#666", animated: false, dashed: false };
  }
  if (targetStatus === "error") {
    return { stroke: "#ef4444", animated: false, dashed: false };
  }
  return { stroke: "#444", animated: false, dashed: true };
}

// ── Dagre layout ────────────────────────────────────────────────────

const NODE_WIDTH = 120;
const NODE_HEIGHT = 32;
const FONT_SIZE = 11;
const ARROW_SIZE = 6;
/** Inline (bounded) graph height. The whole graph is scaled to fit this box
 *  via preserveAspectRatio; expand to a Dialog for pan/zoom. */
const FIT_HEIGHT = 240;

export function computeLayout(
  steps: FlowGraphStep[],
  opts: { showErrorRoutes?: boolean } = {},
): LayoutResult {
  if (steps.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const showErrorRoutes = opts.showErrorRoutes ?? true;

  // Single edge derivation (shared with the static Mermaid snapshot). Route
  // edges (on_complete/on_error) appear whenever the caller passes them: the
  // static path parses YAML, the live path now receives them on
  // flow:flow-started. See change: fix-flow-ui-graph-zoom-summary.
  const flowEdges = deriveFlowEdges(
    steps.map((s): FlowEdgeStep => ({
      id: s.id,
      type: s.type ?? "agent",
      blockedBy: s.blockedBy,
      branches: s.branches,
      onComplete: s.onComplete,
      onError: s.onError,
    })),
  );

  const isOnError = (e: FlowEdge) => e.kind === "route" && e.label === "on_error";
  const onErrorEdges = flowEdges.filter(isOnError);
  const terminalHandlerIds = new Set(
    onErrorEdges.filter(e => e.routeTopology === "terminal").map(e => e.to),
  );

  // A node reached ONLY via on_error routes is an error-only handler (returning
  // or terminal). Roots (no incoming edge at all) are NOT error-only.
  const incoming = new Map<string, FlowEdge[]>();
  for (const e of flowEdges) {
    const list = incoming.get(e.to);
    if (list) list.push(e); else incoming.set(e.to, [e]);
  }
  const isErrorOnly = (id: string) => {
    const inc = incoming.get(id) ?? [];
    return inc.length > 0 && inc.every(isOnError);
  };

  // Terminal handlers collapse into ONE sink (excluded as real nodes). When the
  // error layer is hidden, every error-only node leaves too — graph height then
  // matches a flow with no on_error declared (zero footprint).
  const excluded = new Set<string>(terminalHandlerIds);
  if (!showErrorRoutes) {
    for (const s of steps) if (isErrorOnly(s.id)) excluded.add(s.id);
  }
  const laidOutSteps = steps.filter(s => !excluded.has(s.id));
  const laidOutIds = new Set(laidOutSteps.map(s => s.id));

  const SINK_ID = "__errorSink__";
  const SINK_W = 96;
  const haveSink = showErrorRoutes && terminalHandlerIds.size > 0;

  const statusMap = new Map<string, FlowGraphStep["status"]>();
  for (const step of steps) statusMap.set(step.id, step.status);

  // Feed EVERY edge to dagre with an acyclicer, so loops/back-edges are ranked
  // AND routed by dagre itself. dagre threads edges through routing channels
  // (dummy nodes) so a polyline goes AROUND nodes instead of through them — this
  // is what eliminates the old hand-routed legs that sliced across node boxes.
  // Terminal on_error edges are redirected to the collapsed sink node.
  const g = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  // Flatter layout: tighter vertical node gap + small edgesep packs the graph
  // (edges may overlap slightly — acceptable) so it reads more horizontal.
  g.setGraph({ rankdir: "LR", nodesep: 12, edgesep: 8, ranksep: 46, marginx: 16, marginy: 16, acyclicer: "greedy" });

  for (const step of laidOutSteps) g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  if (haveSink) g.setNode(SINK_ID, { width: SINK_W, height: NODE_HEIGHT });

  interface EdgeSpec {
    from: string; to: string; dTo: string; label?: string;
    kind: FlowEdgeKind; isError: boolean; isReturning: boolean; isLoop: boolean;
  }
  const specs: EdgeSpec[] = [];
  for (const e of flowEdges) {
    const err = isOnError(e);
    if (err && !showErrorRoutes) continue;
    const terminal = err && e.routeTopology === "terminal";
    const dTo = terminal ? SINK_ID : e.to;
    if (!laidOutIds.has(e.from)) continue;
    if (dTo !== SINK_ID && !laidOutIds.has(dTo)) continue;
    g.setEdge(e.from, dTo, e.label ? { width: e.label.length * 6 + 6, height: 12 } : {});
    specs.push({
      from: e.from, to: e.to, dTo, label: e.label, kind: e.kind,
      isError: err, isReturning: err && e.routeTopology === "returning", isLoop: !!e.backward,
    });
  }

  dagreLayout(g, {});

  const nodes: PositionedNode[] = laidOutSteps.map((step) => {
    const n = g.node(step.id);
    return {
      id: step.id,
      label: step.label,
      status: step.status,
      type: step.type,
      x: n.x - NODE_WIDTH / 2,
      y: n.y - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  // Every edge rendered from dagre's routed waypoints (multi-segment, node-aware).
  const edges: PositionedEdge[] = [];
  for (const s of specs) {
    const ed = g.edge(s.from, s.dTo);
    if (!ed?.points) continue;
    edges.push({
      source: s.from,
      target: s.to,
      points: ed.points,
      sourceStatus: statusMap.get(s.from) || "pending",
      targetStatus: statusMap.get(s.to) || "pending",
      label: s.label,
      kind: s.kind,
      isError: s.isError,
      isReturning: s.isReturning,
      isLoop: s.isLoop,
    });
  }

  let errorSink: ErrorSink | undefined;
  if (haveSink) {
    const sn = g.node(SINK_ID);
    errorSink = {
      x: sn.x - SINK_W / 2,
      y: sn.y - NODE_HEIGHT / 2,
      width: SINK_W,
      height: NODE_HEIGHT,
      handlers: Array.from(terminalHandlerIds),
    };
  }

  const meta = g.graph();
  return { nodes, edges, errorSink, width: meta.width || 200, height: meta.height || 50 };
}

// ── SVG edge path (cubic bezier through waypoints) ──────────────────

function buildEdgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  const [first, ...rest] = points;
  if (rest.length === 1) {
    return `M${first.x},${first.y} L${rest[0].x},${rest[0].y}`;
  }
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < rest.length; i++) {
    if (i === 0) {
      const cp1x = first.x + (rest[0].x - first.x) * 0.5;
      d += ` C${cp1x},${first.y} ${cp1x},${rest[0].y} ${rest[0].x},${rest[0].y}`;
    } else {
      const prev = rest[i - 1];
      const curr = rest[i];
      const cpx = prev.x + (curr.x - prev.x) * 0.5;
      d += ` C${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }
  }
  return d;
}

// ── Component ───────────────────────────────────────────────────────

export function FlowGraph({ steps, fit = false, onExpand, selectedStepId, onSelectStep }: {
  steps: FlowGraphStep[];
  /** Bounded, static, whole-graph-fits-the-window (no pan/zoom). Default false. */
  fit?: boolean;
  /** When set (and `fit`), shows a ⤢ expand button that opens the graph bigger. */
  onExpand?: () => void;
  /** Currently-selected step id — renders a ring on the matching node.
   *  See change: improve-flow-graph-dialog-and-card-interaction. */
  selectedStepId?: string | null;
  /** Node click handler (toggle selection). When set, nodes are clickable. */
  onSelectStep?: (stepId: string) => void;
}) {
  // Error-route layer toggle. Default ON: returning routes show as red loop
  // arcs, terminal handlers collapse to one sink. OFF removes them from the
  // dagre input entirely (zero footprint). Only relevant when on_error exists.
  const hasErrorRoutes = useMemo(() => steps.some(s => s.onError), [steps]);
  // Error routes are an exception layer — hidden by default to keep the happy
  // path legible; the ⚠ toggle reveals them. Visibility persists globally (a
  // viewing preference across all graphs). See change: fix-flow-ui-graph-zoom-summary.
  const [showErrorRoutes, toggleShowErrorRoutes] = usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false);
  const [sinkExpanded, setSinkExpanded] = useState(false);

  const layout = useMemo(() => {
    if (steps.length === 0) return null;
    try {
      return computeLayout(steps, { showErrorRoutes });
    } catch (err) {
      console.error("[FlowGraph] computeLayout failed:", err, "steps:", steps);
      return null;
    }
  }, [steps, showErrorRoutes]);

  const t = useT();
  const ZoomControls = useUiPrimitive(UI_PRIMITIVE_KEYS.zoomControls);
  const { state: zoom, handlers, zoomIn, zoomOut, reset } = useZoomPan();
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom/pan when the graph layout changes (new steps, different dimensions)
  const prevStepCount = useRef(steps.length);
  useEffect(() => {
    if (steps.length !== prevStepCount.current) {
      prevStepCount.current = steps.length;
      reset();
    }
  }, [steps.length, reset]);

  // Attach non-passive wheel listener (React onWheel is passive and can't preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const wheelHandler = handlers.onWheel as EventListener;
    el.addEventListener("wheel", wheelHandler, { passive: false });
    return () => el.removeEventListener("wheel", wheelHandler);
  }, [handlers.onWheel]);

  if (!layout || layout.nodes.length === 0) return null;

  const svgWidth = Math.max(layout.width, 150);
  const svgHeight = Math.max(layout.height, 50);

  // Pan/zoom is enabled in BOTH the in-socket (fit) and dialog (non-fit) views.
  // In fit mode the container clips (overflow:hidden) so panning never spills
  // over sibling cards; the graph still defaults to whole-graph-fits via
  // preserveAspectRatio, with zoom/pan layered on top.
  const panHandlers = {
    onPointerDown: handlers.onPointerDown,
    onPointerMove: handlers.onPointerMove,
    onPointerUp: handlers.onPointerUp,
    onDoubleClick: handlers.onDoubleClick,
    onTouchMove: handlers.onTouchMove,
    onTouchEnd: handlers.onTouchEnd,
  };

  return (
    <div
      ref={containerRef}
      className="flow-dag-graph-container relative flex items-center justify-center"
      style={fit ? { height: FIT_HEIGHT, overflow: "hidden" } : { width: "100%", height: "100%", overflow: "visible" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...panHandlers}
    >
      {/* No onPointerDown stopPropagation needed: useZoomPan defers pointer
          capture until movement exceeds the drag threshold, so a click on these
          controls stays a click. ZoomControls still self-guards its own drag. */}
      {fit && onExpand && (
        <button
          type="button"
          onClick={onExpand}
          title={t("expandGraph", undefined, "Expand graph")}
          className="absolute bottom-1 right-1 z-10 text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/80 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          ⤢ Expand
        </button>
      )}
      {hasErrorRoutes && (
        <button
          type="button"
          onClick={toggleShowErrorRoutes}
          title={showErrorRoutes ? "Hide error routes" : "Show error routes"}
          aria-pressed={showErrorRoutes}
          className={`absolute top-1 left-1 z-10 text-[11px] px-1.5 py-0.5 rounded border ${showErrorRoutes ? "border-[#ef4444]/60 text-[#ef4444]" : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"} bg-[var(--bg-secondary)]/80 hover:text-[var(--text-primary)]`}
        >
          ⚠ error routes
        </button>
      )}
      {hovered && (
        <div>
          <ZoomControls
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={reset}
            scale={zoom.scale}
          />
        </div>
      )}
      <div
        style={{
          ...(fit ? { width: "100%", height: "100%" } : {}),
          transform: `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          width={fit ? "100%" : svgWidth}
          height={fit ? "100%" : svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio={fit ? "xMidYMid meet" : undefined}
          className="flow-dag-graph"
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            {["#444", "#666", "#22c55e", "#eab308", "#ef4444", "#a855f7"].map((color) => (
              <marker
                key={color}
                id={`arrow-${color.replace("#", "")}`}
                viewBox={`0 0 ${ARROW_SIZE * 2} ${ARROW_SIZE * 2}`}
                refX={ARROW_SIZE * 2 - 1}
                refY={ARROW_SIZE}
                markerWidth={ARROW_SIZE}
                markerHeight={ARROW_SIZE}
                orient="auto-start-reverse"
              >
                <path d={`M0,0 L${ARROW_SIZE * 2},${ARROW_SIZE} L0,${ARROW_SIZE * 2} Z`} fill={color} />
              </marker>
            ))}
          </defs>

          {/* Edges — every edge routed by dagre (waypoints thread around nodes,
              never through them). Styled by class: red on_error (↺ returning /
              ⊗ terminal), purple loop, status-grey otherwise. */}
          {layout.edges.map((edge, i) => {
            let stroke: string;
            let dash: string;
            let animated = false;
            if (edge.isError) {
              stroke = "#ef4444";
              dash = "5 4";
            } else if (edge.isLoop) {
              stroke = "#a855f7";
              dash = "5 3";
            } else {
              const c = getEdgeColor(edge.sourceStatus, edge.targetStatus);
              stroke = c.stroke;
              dash = c.dashed ? "4 3" : c.animated ? "6 3" : "none";
              animated = c.animated;
            }
            const mid = edge.points[Math.floor(edge.points.length / 2)];
            // `on_complete` is the happy-path default — render unlabeled to avoid
            // labelling every arrow on an on_complete-wired flow. Keep branch +
            // on_error labels. See change: fix-flow-ui-graph-zoom-summary.
            const label = edge.isError
              ? `on_error ${edge.isReturning ? "↺" : "⊗"}`
              : edge.label === "on_complete" ? undefined : edge.label;
            const labelColor = edge.isError ? "#ef4444" : edge.isLoop ? "#a855f7" : "#888";
            return (
              <g key={`edge-${i}`}>
                <path
                  d={buildEdgePath(edge.points)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  strokeDasharray={dash}
                  markerEnd={`url(#arrow-${stroke.replace("#", "")})`}
                  className={animated ? "flow-edge-animated" : ""}
                  opacity={edge.isError || edge.isLoop ? 0.8 : 1}
                />
                {label && mid && (
                  <text
                    x={mid.x}
                    y={mid.y - 3}
                    fontSize={8}
                    fill={labelColor}
                    textAnchor="middle"
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Collapsed terminal-handler sink (`⚠ N exits`), click to expand. */}
          {layout.errorSink && (
            <g
              data-error-sink=""
              style={{ cursor: "pointer" }}
              onClick={() => setSinkExpanded(v => !v)}
            >
              <rect
                x={layout.errorSink.x}
                y={layout.errorSink.y}
                width={layout.errorSink.width}
                height={layout.errorSink.height}
                rx={5}
                ry={5}
                fill="#2a1416"
                stroke="#ef4444"
                strokeWidth={1.5}
              />
              <text
                x={layout.errorSink.x + layout.errorSink.width / 2}
                y={layout.errorSink.y + layout.errorSink.height / 2 + 1}
                fontSize={10}
                fill="#ef4444"
                dominantBaseline="middle"
                textAnchor="middle"
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {`⚠ ${layout.errorSink.handlers.length} exit${layout.errorSink.handlers.length === 1 ? "" : "s"}`}
              </text>
              {/* Expanded handler list stacks below the sink. */}
              {sinkExpanded && layout.errorSink.handlers.map((h, hi) => (
                <g key={`sink-h-${h}`}>
                  <rect
                    x={layout.errorSink!.x}
                    y={layout.errorSink!.y + layout.errorSink!.height + 6 + hi * (NODE_HEIGHT + 6)}
                    width={layout.errorSink!.width}
                    height={NODE_HEIGHT}
                    rx={5}
                    ry={5}
                    fill="#2a1416"
                    stroke="#ef4444"
                    strokeWidth={1}
                    opacity={0.85}
                  />
                  <text
                    x={layout.errorSink!.x + layout.errorSink!.width / 2}
                    y={layout.errorSink!.y + layout.errorSink!.height + 6 + hi * (NODE_HEIGHT + 6) + NODE_HEIGHT / 2 + 1}
                    fontSize={10}
                    fill="#ef4444"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {h}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Nodes */}
          {layout.nodes.map((node) => {
            const style = STATUS_COLORS[node.status] || STATUS_COLORS.pending;
            const isRunning = node.status === "running";
            // Per-kind visual: mdi icon + accent matching the cards (code=cyan,
            // fork=amber, agent=green/status). Border/fill stay status-driven.
            const visual = KIND_VISUAL[node.type ?? "agent"] ?? KIND_VISUAL.agent;
            const accent = visual.accent;
            const ICON_SIZE = 13;
            const iconX = node.x + 7;
            const iconY = node.y + (node.height - ICON_SIZE) / 2;
            const iconScale = ICON_SIZE / 24;
            const labelX = node.x + 7 + ICON_SIZE + 4;
            const availW = node.x + node.width - labelX - 8;
            const naturalW = node.label.length * FONT_SIZE * 0.6;
            const labelFontSize = naturalW > availW
              ? Math.max(7, FONT_SIZE * (availW / naturalW))
              : FONT_SIZE;

            const isSelected = node.id === selectedStepId;
            return (
              <g
                key={node.id}
                data-node={node.id}
                style={{ cursor: onSelectStep ? "pointer" : "default" }}
                className={`${isRunning ? "flow-node-running" : ""}${isSelected ? " flow-node-selected" : ""}`.trim()}
                onClick={onSelectStep ? () => onSelectStep(node.id) : undefined}
              >
                {/* Selection ring (accent glow). See change:
                    improve-flow-graph-dialog-and-card-interaction. */}
                {isSelected && (
                  <rect
                    x={node.x - 3}
                    y={node.y - 3}
                    width={node.width + 6}
                    height={node.height + 6}
                    rx={7}
                    ry={7}
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth={2}
                  />
                )}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={5}
                  ry={5}
                  fill={style.fill}
                  stroke={isSelected ? "#60a5fa" : style.border}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                {/* Kind accent stripe (code=cyan, fork=amber); agent has none. */}
                {accent && (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={4}
                    height={node.height}
                    rx={2}
                    ry={2}
                    fill={accent}
                  />
                )}
                {/* mdi kind icon (24-unit path scaled), tinted by accent or status. */}
                <path
                  d={visual.icon}
                  transform={`translate(${iconX}, ${iconY}) scale(${iconScale})`}
                  fill={accent ?? style.text}
                />
                <text
                  x={labelX}
                  y={node.y + node.height / 2 + 1}
                  fontSize={labelFontSize}
                  fill={style.text}
                  dominantBaseline="middle"
                  textAnchor="start"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
