import React, { useMemo, useRef, useState, useEffect } from "react";
import { useZoomPan } from "../../../client/src/hooks/useZoomPan.js";
import { ZoomControls } from "../../../client/src/components/ZoomControls.js";
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
import type { FlowState, ArchitectDagStep } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// ── Types ───────────────────────────────────────────────────────────

/** Step type determines visual rendering:
 *  - "agent" (default): solid rounded rect
 *  - "fork": diamond-shaped (rotated rect) for decision points
 *  - "loop": rounded rect with loop icon/double border
 *  - "flow-ref": dashed border for subflows
 */
export type FlowStepType = "agent" | "fork" | "loop" | "conditional" | "flow-ref";

/** Map flow engine stepType string to graph visual type */
export function mapStepType(stepType: string | undefined): FlowStepType | undefined {
  switch (stepType) {
    case "fork":
    case "conditional":
    case "agent-decision": return "fork";
    case "agent-loop-decision": return "loop";
    case "flow-ref": return "flow-ref";
    default: return undefined; // "agent" → default styling
  }
}

export interface FlowGraphStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "error" | "blocked";
  blockedBy: string[];
  type?: FlowStepType;
  /** For loop steps: the step ID to loop back to (rendered as a backward arrow) */
  loopTarget?: string;
}

/** Step types that act as segment separators (non-agent control flow) */
const SEPARATOR_STEP_TYPES = new Set(["fork", "conditional", "agent-decision", "agent-loop-decision", "flow-ref"]);

/** Synthesize implicit sequential edges that aren't expressed in blockedBy.
 *  - Steps after a separator with no blockedBy get an edge from the preceding separator.
 *  - Loop exit_target steps get an edge from the loop step. */
export function synthesizeImplicitEdges(
  steps: FlowGraphStep[],
  dagSteps: Array<{ id: string; stepType?: string; exitTarget?: string }>,
): void {
  const allStepIds = new Set(steps.map(s => s.id));
  const stepById = new Map(steps.map(s => [s.id, s]));

  // 1. Exit target edges: loop-decision → exit_target
  for (const ds of dagSteps) {
    if (ds.exitTarget && allStepIds.has(ds.exitTarget)) {
      const target = stepById.get(ds.exitTarget);
      if (target && !target.blockedBy.includes(ds.id)) {
        target.blockedBy = [...target.blockedBy, ds.id];
      }
    }
  }

  // 2. Implicit segment edges: steps with no blockedBy after a separator
  for (let i = 1; i < dagSteps.length; i++) {
    const curr = stepById.get(dagSteps[i].id);
    if (!curr || curr.blockedBy.length > 0) continue;

    for (let j = i - 1; j >= 0; j--) {
      const prev = dagSteps[j];
      if (prev.stepType && SEPARATOR_STEP_TYPES.has(prev.stepType) && allStepIds.has(prev.id)) {
        curr.blockedBy = [prev.id];
        break;
      }
      if ((!prev.stepType || prev.stepType === "agent") && allStepIds.has(prev.id)) {
        curr.blockedBy = [prev.id];
        break;
      }
    }
  }
}

// ── Data converters ────────────────────────────────────────────────

/** Convert FlowState (running/completed flow) to FlowGraphStep array.
 *  Uses dagSteps when available, falls back to agents map for backward compat. */
export function flowStateToGraphSteps(flowState: FlowState): FlowGraphStep[] {
  if (flowState.dagSteps && flowState.dagSteps.length > 0) {
    const stepStatus = new Map<string, FlowGraphStep["status"]>();
    for (const [key, agent] of flowState.agents) {
      stepStatus.set(key, agent.status);
      if (agent.stepId) stepStatus.set(agent.stepId, agent.status);
      stepStatus.set(agent.agentName, agent.status);
    }

    const allStepIds = new Set(flowState.dagSteps.map(s => s.id));
    const steps: FlowGraphStep[] = flowState.dagSteps.map(step => ({
      id: step.id,
      label: step.id,
      status: stepStatus.get(step.id) || stepStatus.get(step.agent || "") || "pending",
      blockedBy: step.blockedBy.filter(dep => allStepIds.has(dep)),
      type: mapStepType(step.stepType),
      loopTarget: step.loopTarget && allStepIds.has(step.loopTarget) ? step.loopTarget : undefined,
    }));

    // Add flow-ref steps not in dagSteps
    for (const ref of flowState.flowRefSteps || []) {
      if (!allStepIds.has(ref.id)) {
        steps.push({
          id: ref.id,
          label: ref.label,
          status: "pending",
          blockedBy: ref.blockedBy.filter(dep => allStepIds.has(dep)),
          type: "flow-ref",
        });
      }
    }

    synthesizeImplicitEdges(steps, flowState.dagSteps);
    return steps;
  }

  // Fallback: build from agents map (backward compat for old events without dagSteps)
  const stepToAgent = new Map<string, string>();
  for (const agent of flowState.agents.values()) {
    if (agent.stepId) stepToAgent.set(agent.stepId, agent.agentName);
  }
  const agentSteps: FlowGraphStep[] = Array.from(flowState.agents.values()).map(agent => ({
    id: agent.agentName,
    label: agent.label || agent.agentName,
    status: agent.status,
    blockedBy: agent.blockedBy
      .map(depId => stepToAgent.get(depId) || depId)
      .filter(name => flowState.agents.has(name) || flowState.flowRefSteps?.some(r => r.id === name)),
  }));
  const flowRefSteps: FlowGraphStep[] = (flowState.flowRefSteps || []).map(ref => ({
    id: ref.id,
    label: ref.label,
    status: "pending" as const,
    blockedBy: ref.blockedBy.map(depId => stepToAgent.get(depId) || depId),
    type: "flow-ref" as const,
  }));
  return [...agentSteps, ...flowRefSteps];
}

/** Convert ArchitectState dagSteps (design-time, all pending) to FlowGraphStep array. */
export function architectStepsToGraphSteps(dagSteps: ArchitectDagStep[]): FlowGraphStep[] {
  const allStepIds = new Set(dagSteps.map(s => s.id));
  const steps: FlowGraphStep[] = dagSteps.map((step) => ({
    id: step.id,
    label: step.agentName || step.id,
    status: "pending" as const,
    blockedBy: [...step.blockedBy],
    type: mapStepType(step.stepType),
    loopTarget: step.loopTarget && allStepIds.has(step.loopTarget) ? step.loopTarget : undefined,
  }));

  synthesizeImplicitEdges(steps, dagSteps);
  return steps;
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
}

interface LoopBackEdge {
  source: string;
  target: string;
  sourceStatus: FlowGraphStep["status"];
  targetStatus: FlowGraphStep["status"];
  path: string;
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

export function computeLayout(steps: FlowGraphStep[]): LayoutResult {
  if (steps.length === 0) {
    return { nodes: [], edges: [], loopEdges: [], width: 0, height: 0 };
  }

  const g = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 15, ranksep: 40, marginx: 16, marginy: 16 });

  const statusMap = new Map<string, FlowGraphStep["status"]>();
  for (const step of steps) {
    g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    statusMap.set(step.id, step.status);
  }

  for (const step of steps) {
    for (const dep of step.blockedBy) {
      if (statusMap.has(dep)) {
        g.setEdge(dep, step.id);
      }
    }
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
  for (const step of steps) {
    for (const dep of step.blockedBy) {
      if (statusMap.has(dep)) {
        const edgeData = g.edge(dep, step.id);
        if (edgeData) {
          edges.push({
            source: dep,
            target: step.id,
            points: edgeData.points,
            sourceStatus: statusMap.get(dep) || "pending",
            targetStatus: step.status,
          });
        }
      }
    }
  }

  // Compute loop-back edges (backward arrows that skip dagre to avoid cycles)
  const loopEdges: LoopBackEdge[] = [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const LOOP_MARGIN = 24; // vertical space above the graph for loop arcs

  // Find the topmost node edge to route arcs above everything
  let minY = Infinity;
  for (const n of nodes) {
    if (n.y < minY) minY = n.y;
  }

  for (const step of steps) {
    if (step.loopTarget && nodeById.has(step.loopTarget)) {
      const src = nodeById.get(step.id)!;
      const tgt = nodeById.get(step.loopTarget)!;
      // Arc above the entire graph so it doesn't overlap any nodes
      const srcCx = src.x + src.width / 2;
      const srcTop = src.y;
      const tgtCx = tgt.x + tgt.width / 2;
      const tgtTop = tgt.y;
      const arcY = minY - LOOP_MARGIN;
      const path = `M${srcCx},${srcTop} C${srcCx},${arcY} ${tgtCx},${arcY} ${tgtCx},${tgtTop}`;
      loopEdges.push({
        source: step.id,
        target: step.loopTarget,
        sourceStatus: step.status,
        targetStatus: statusMap.get(step.loopTarget) || "pending",
        path,
      });
    }
  }

  // Compute bounding box including loop arcs
  const graphWidth = graphMeta.width || 200;
  const graphHeight = graphMeta.height || 50;
  const loopArcTop = loopEdges.length > 0 ? minY - LOOP_MARGIN - ARROW_SIZE : 0;
  const yOffset = loopArcTop < 0 ? -loopArcTop : 0;

  // Shift all geometry down to make room for arcs above
  if (yOffset > 0) {
    for (const n of nodes) n.y += yOffset;
    for (const e of edges) {
      for (const p of e.points) p.y += yOffset;
    }
    for (const le of loopEdges) {
      // Recompute path with shifted coordinates
      const src = nodeById.get(le.source)!;
      const tgt = nodeById.get(le.target)!;
      const srcCx = src.x + src.width / 2;
      const srcTop = src.y;
      const tgtCx = tgt.x + tgt.width / 2;
      const tgtTop = tgt.y;
      const arcY = ARROW_SIZE; // top of SVG with small padding
      le.path = `M${srcCx},${srcTop} C${srcCx},${arcY} ${tgtCx},${arcY} ${tgtCx},${tgtTop}`;
    }
  }

  // Compute actual bounding box from positioned nodes (dagre's reported
  // dimensions may not account for yOffset shift or full node extents)
  let maxRight = 0;
  let maxBottom = 0;
  for (const n of nodes) {
    const right = n.x + n.width;
    const bottom = n.y + n.height;
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  const actualWidth = Math.max(graphWidth, maxRight + 16);
  const actualHeight = Math.max(graphHeight + yOffset, maxBottom + 16);

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

export function FlowGraph({ steps }: { steps: FlowGraphStep[] }) {
  const layout = useMemo(() => {
    if (steps.length === 0) return null;
    try {
      return computeLayout(steps);
    } catch (err) {
      console.error("[FlowGraph] computeLayout failed:", err, "steps:", steps);
      return null;
    }
  }, [steps]);

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

  return (
    <div
      ref={containerRef}
      className="flow-dag-graph-container relative"
      style={{ overflow: "visible" }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onDoubleClick={handlers.onDoubleClick}
      onTouchMove={handlers.onTouchMove}
      onTouchEnd={handlers.onTouchEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <ZoomControls
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={reset}
          scale={zoom.scale}
        />
      )}
      <div
        style={{
          transform: `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
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

          {/* Edges */}
          {layout.edges.map((edge, i) => {
            const { stroke, animated, dashed } = getEdgeColor(edge.sourceStatus, edge.targetStatus);
            return (
              <path
                key={`edge-${i}`}
                d={buildEdgePath(edge.points)}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeDasharray={dashed ? "4 3" : animated ? "6 3" : "none"}
                markerEnd={`url(#arrow-${stroke.replace("#", "")})`}
                className={animated ? "flow-edge-animated" : ""}
              />
            );
          })}

          {/* Loop-back edges (backward arrows below the graph) */}
          {layout.loopEdges.map((edge, i) => (
            <path
              key={`loop-${i}`}
              d={edge.path}
              fill="none"
              stroke="#a855f7"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              markerEnd="url(#arrow-a855f7)"
              opacity={0.7}
            />
          ))}

          {/* Nodes */}
          {layout.nodes.map((node) => {
            const style = STATUS_COLORS[node.status] || STATUS_COLORS.pending;
            const isRunning = node.status === "running";
            // Add type prefix icon to label
            const typePrefix = node.type === "fork" ? "◇ "
              : node.type === "loop" ? "↻ "
              : node.type === "conditional" ? "? "
              : "";
            const displayLabel = typePrefix + node.label;
            const availW = node.width - 16;
            const naturalW = displayLabel.length * FONT_SIZE * 0.6;
            const labelFontSize = naturalW > availW
              ? Math.max(7, FONT_SIZE * (availW / naturalW))
              : FONT_SIZE;

            return (
              <g
                key={node.id}
                data-node={node.id}
                style={{ cursor: "default" }}
                className={isRunning ? "flow-node-running" : ""}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={5}
                  ry={5}
                  fill={style.fill}
                  stroke={style.border}
                  strokeWidth={1.5}
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 + 1}
                  fontSize={labelFontSize}
                  fill={style.text}
                  dominantBaseline="middle"
                  textAnchor="middle"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {displayLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
