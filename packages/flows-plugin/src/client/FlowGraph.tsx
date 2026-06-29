import React, { useMemo, useRef, useState, useEffect } from "react";
// useZoomPan is a HOOK — it cannot go through the registry (Rules of Hooks).
// Stays as a direct import. See add-plugin-ui-primitive-registry Decision 4.
import { useZoomPan } from "@blackbelt-technology/pi-dashboard-client-utils/useZoomPan";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
import { mdiCodeTags, mdiCallSplit, mdiSourceBranch, mdiRobotOutline } from "@mdi/js";
import type { FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { deriveFlowEdges, type FlowEdgeStep } from "./flow-edges.js";

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
}

/** Backward/loop edge, hand-routed as an arc below the node band (dashed purple). */
interface LoopBackEdge {
  source: string;
  target: string;
  sourceStatus: FlowGraphStep["status"];
  targetStatus: FlowGraphStep["status"];
  path: string;
  label?: string;
  labelX: number;
  labelY: number;
}

interface LayoutResult {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  loopEdges: LoopBackEdge[];
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

export function computeLayout(steps: FlowGraphStep[]): LayoutResult {
  if (steps.length === 0) {
    return { nodes: [], edges: [], loopEdges: [], width: 0, height: 0 };
  }

  const g = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  // Only FORWARD edges feed dagre (keeps the acyclic ranking clean + compact).
  // Backward/loop edges are hand-routed BELOW the node band so they never feed
  // a cycle into dagre (which mangles the layout) and never cross a node.
  // `edgesep` fans out decision edges at a shared source. See change: improve-flow-ui.
  g.setGraph({ rankdir: "LR", nodesep: 15, edgesep: 22, ranksep: 44, marginx: 16, marginy: 16 });

  const statusMap = new Map<string, FlowGraphStep["status"]>();
  for (const step of steps) {
    g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    statusMap.set(step.id, step.status);
  }

  // Single edge derivation (sequential blockedBy + decision branches), shared
  // with the static Mermaid snapshot. FORWARD edges feed dagre layout (with
  // label clearance); BACKWARD edges are hand-routed below the graph.
  // See change: improve-flow-ui.
  const flowEdges = deriveFlowEdges(
    steps.map((s): FlowEdgeStep => ({ id: s.id, type: s.type ?? "agent", blockedBy: s.blockedBy, branches: s.branches })),
  );
  const forwardEdges = flowEdges.filter(e => !e.backward);
  const backwardEdges = flowEdges.filter(e => e.backward);
  for (const e of forwardEdges) {
    const labelDims = e.label ? { width: e.label.length * 6 + 6, height: 12 } : {};
    g.setEdge(e.from, e.to, labelDims);
  }

  dagreLayout(g, {});

  const graphMeta = g.graph();
  const nodes: PositionedNode[] = steps.map((step) => {
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

  const edges: PositionedEdge[] = [];
  for (const e of forwardEdges) {
    const edgeData = g.edge(e.from, e.to);
    if (edgeData?.points) {
      edges.push({
        source: e.from,
        target: e.to,
        points: edgeData.points,
        sourceStatus: statusMap.get(e.from) || "pending",
        targetStatus: statusMap.get(e.to) || "pending",
        label: e.label,
      });
    }
  }

  // Node-band extent (every node sits within [minNodeY, maxBottom]).
  const graphWidth = graphMeta.width || 200;
  const graphHeight = graphMeta.height || 50;
  let maxRight = 0;
  let maxBottom = 0;
  for (const n of nodes) {
    maxRight = Math.max(maxRight, n.x + n.width);
    maxBottom = Math.max(maxBottom, n.y + n.height);
  }
  for (const e of edges) {
    for (const p of e.points) maxRight = Math.max(maxRight, p.x);
  }

  // Backward/loop edges: route as an arc BELOW every node. Because the arc's
  // horizontal run sits beneath `maxBottom`, it cannot cross any node. Multiple
  // loops stagger downward so they don't overlap each other.
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const LOOP_GAP = 18;
  const loopEdges: LoopBackEdge[] = [];
  backwardEdges.forEach((e, idx) => {
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) return;
    const src = nodeById.get(e.from)!;
    const tgt = nodeById.get(e.to)!;
    const srcCx = src.x + src.width / 2;
    const srcBot = src.y + src.height;
    const tgtCx = tgt.x + tgt.width / 2;
    const tgtBot = tgt.y + tgt.height;
    const arcY = maxBottom + LOOP_GAP + idx * LOOP_GAP;
    const path = `M${srcCx},${srcBot} C${srcCx},${arcY} ${tgtCx},${arcY} ${tgtCx},${tgtBot}`;
    loopEdges.push({
      source: e.from,
      target: e.to,
      sourceStatus: statusMap.get(e.from) || "pending",
      targetStatus: statusMap.get(e.to) || "pending",
      path,
      label: e.label,
      labelX: (srcCx + tgtCx) / 2,
      labelY: arcY + 3,
    });
  });

  const loopBottom = loopEdges.length > 0 ? maxBottom + LOOP_GAP * (loopEdges.length + 1) : maxBottom;
  const actualWidth = Math.max(graphWidth, maxRight + 16);
  const actualHeight = Math.max(graphHeight, loopBottom + ARROW_SIZE + 8);

  return {
    nodes,
    edges,
    loopEdges,
    width: actualWidth,
    height: actualHeight,
  };
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
  const layout = useMemo(() => {
    if (steps.length === 0) return null;
    try {
      return computeLayout(steps);
    } catch (err) {
      console.error("[FlowGraph] computeLayout failed:", err, "steps:", steps);
      return null;
    }
  }, [steps]);

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

  // Fit mode is bounded + static: pan/zoom handlers are detached so the graph
  // cannot be dragged over sibling content (cards / summaries). The whole graph
  // scales into FIT_HEIGHT via preserveAspectRatio. See change: improve-flow-ui.
  const panHandlers = fit ? {} : {
    onPointerDown: handlers.onPointerDown,
    onPointerMove: handlers.onPointerMove,
    onPointerUp: handlers.onPointerUp,
    onDoubleClick: handlers.onDoubleClick,
    onTouchMove: handlers.onTouchMove,
    onTouchEnd: handlers.onTouchEnd,
  };

  return (
    <div
      ref={fit ? undefined : containerRef}
      className="flow-dag-graph-container relative"
      style={fit ? { height: FIT_HEIGHT, overflow: "hidden" } : { overflow: "visible" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...panHandlers}
    >
      {fit && onExpand && (
        <button
          type="button"
          onClick={onExpand}
          title="Expand graph"
          className="absolute top-1 right-1 z-10 text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/80 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          ⤢ Expand
        </button>
      )}
      {!fit && hovered && (
        <ZoomControls
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={reset}
          scale={zoom.scale}
        />
      )}
      <div
        style={fit ? { width: "100%", height: "100%" } : {
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

          {/* Forward edges (dagre-routed). */}
          {layout.edges.map((edge, i) => {
            const { stroke, animated, dashed } = getEdgeColor(edge.sourceStatus, edge.targetStatus);
            const mid = edge.points[Math.floor(edge.points.length / 2)];
            return (
              <g key={`edge-${i}`}>
                <path
                  d={buildEdgePath(edge.points)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  strokeDasharray={dashed ? "4 3" : animated ? "6 3" : "none"}
                  markerEnd={`url(#arrow-${stroke.replace("#", "")})`}
                  className={animated ? "flow-edge-animated" : ""}
                />
                {edge.label && mid && (
                  <text
                    x={mid.x}
                    y={mid.y - 3}
                    fontSize={8}
                    fill="#888"
                    textAnchor="middle"
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Backward/loop edges — arc below the node band; cannot cross a node. */}
          {layout.loopEdges.map((edge, i) => (
            <g key={`loop-${i}`}>
              <path
                d={edge.path}
                fill="none"
                stroke="#a855f7"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                markerEnd="url(#arrow-a855f7)"
                opacity={0.7}
              />
              {edge.label && (
                <text
                  x={edge.labelX}
                  y={edge.labelY}
                  fontSize={8}
                  fill="#a855f7"
                  textAnchor="middle"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {edge.label}
                </text>
              )}
            </g>
          ))}

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
