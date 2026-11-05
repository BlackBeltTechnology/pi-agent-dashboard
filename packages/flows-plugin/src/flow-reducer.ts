/**
 * Flow state machine reducer.
 * Handles all flow_* events and returns updated FlowState.
 *
 * pi-flows 0.10 (design D6): an event carrying `itemIndex` targets the fan-out
 * item card `<stepId>[<i>]` in `groups[stepId]`; the pre-listed step card is
 * the group parent, whose status is DERIVED from its items. `flow_decision`
 * stores the chosen routes and marks unchosen branch targets `skipped`.
 * See change: update-flows-plugin.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type {
  FlowAgentCardConfig,
  FlowAgentState,
  FlowDecisionInfo,
  FlowDetailEntry,
  FlowRecentTool,
  FlowState,
  NodeKind,
} from "./types.js";

// ── Fan-out items ──────────────────────────────────────────────────

/** Fan-out item key: `<stepId>[<i>]`. */
function itemKey(stepId: string, index: number): string {
  return `${stepId}[${index}]`;
}

/** The event's item index, or undefined (a non-negative integer only). */
function itemIndexOf(data: Record<string, unknown>): number | undefined {
  const i = data.itemIndex;
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < 10_000 ? i : undefined;
}

/**
 * Group parent status by the D6 precedence (first match wins): any item
 * running / started-but-pending → running; any error → error (hard if any
 * hard, else soft); any blocked → blocked; all skipped or zero items →
 * skipped; else complete. Rollup counts complete (ok) and error (failed).
 */
export function deriveGroupParent(items: readonly FlowAgentState[]): {
  status: FlowAgentState["status"];
  outcome?: "soft" | "hard";
  rollup: { ok: number; failed: number };
} {
  const present = items.filter(Boolean);
  const rollup = {
    ok: present.filter((i) => i.status === "complete").length,
    failed: present.filter((i) => i.status === "error").length,
  };
  if (present.some((i) => i.status === "running" || i.status === "pending")) return { status: "running", rollup };
  const errors = present.filter((i) => i.status === "error");
  if (errors.length > 0) {
    return { status: "error", outcome: errors.some((i) => i.outcome === "hard") ? "hard" : "soft", rollup };
  }
  if (present.some((i) => i.status === "blocked")) return { status: "blocked", rollup };
  if (present.every((i) => i.status === "skipped")) return { status: "skipped", rollup };
  return { status: "complete", rollup };
}

/** Recompute the group parent card of `stepId` (no-op without a parent card). */
function withDerivedParent(
  agents: Map<string, FlowAgentState>,
  stepId: string,
  items: readonly FlowAgentState[],
): void {
  const parent = agents.get(stepId);
  if (!parent) return;
  const d = deriveGroupParent(items);
  agents.set(stepId, {
    ...parent,
    status: d.status,
    outcome: d.status === "error" ? d.outcome : d.status === "complete" ? "success" : parent.outcome,
    itemCount: items.filter(Boolean).length,
    rollup: d.rollup,
  });
}

/** Apply `fn` to item `i` of group `stepId` (creating it), returning the new state. */
function updateItem(
  flowState: FlowState,
  stepId: string,
  index: number,
  base: () => FlowAgentState,
  fn: (item: FlowAgentState) => FlowAgentState,
  opts: { deriveParent: boolean },
): FlowState {
  const groups = { ...(flowState.groups ?? {}) };
  const items = [...(groups[stepId] ?? [])];
  const existing = items[index] ?? base();
  items[index] = fn(existing);
  groups[stepId] = items;
  if (!opts.deriveParent) return { ...flowState, groups };
  const agents = new Map(flowState.agents);
  withDerivedParent(agents, stepId, items);
  return { ...flowState, groups, agents };
}

function newItem(agentName: string, stepId: string, index: number): FlowAgentState {
  return {
    agentName,
    stepId,
    itemIndex: index,
    itemKey: itemKey(stepId, index),
    status: "pending",
    blockedBy: [],
    recentTools: [],
    detailHistory: [],
  };
}

/** Route an item-indexed event: `fn` on the item, or null when not an item event. */
function reduceItemEvent(
  flowState: FlowState,
  data: Record<string, unknown>,
  fn: (item: FlowAgentState) => FlowAgentState,
  opts: { deriveParent: boolean },
): FlowState | null {
  const index = itemIndexOf(data);
  const stepId = typeof data.stepId === "string" ? data.stepId : undefined;
  if (index === undefined || !stepId) return null;
  const agentName = typeof data.agentName === "string" ? data.agentName : stepId;
  return updateItem(flowState, stepId, index, () => newItem(agentName, stepId, index), fn, opts);
}

// ── Decisions ──────────────────────────────────────────────────────

/** Resolve a decision's chosen route branches to target step ids. */
function decisionTargets(
  flowState: FlowState,
  stepId: string,
  routes: ReadonlyArray<{ branch: string }>,
): { chosen: string[]; all: string[] } {
  const branches = flowState.dagSteps?.find((s) => s.id === stepId)?.branches ?? {};
  const all = [...new Set(Object.values(branches))];
  const chosen: string[] = [];
  for (const r of routes) {
    const t = branches[r.branch] ?? (all.includes(r.branch) ? r.branch : undefined);
    if (t && !chosen.includes(t)) chosen.push(t);
  }
  return { chosen, all };
}

function parseRoutes(v: unknown): Array<{ branch: string; itemCount?: number }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ branch: string; itemCount?: number }> = [];
  for (const r of v) {
    if (!r || typeof r !== "object" || typeof (r as { branch?: unknown }).branch !== "string") continue;
    const ic = (r as { itemCount?: unknown }).itemCount;
    out.push({
      branch: (r as { branch: string }).branch,
      ...(typeof ic === "number" && Number.isFinite(ic) ? { itemCount: ic } : {}),
    });
  }
  return out;
}

function reduceDecision(flowState: FlowState, data: Record<string, unknown>): FlowState {
  const stepId = typeof data.stepId === "string" ? data.stepId : undefined;
  if (!stepId) return flowState;
  const labels = Array.isArray(data.labels) ? data.labels.filter((l): l is string => typeof l === "string") : undefined;
  const routes = parseRoutes(data.routes);
  const routeError = typeof data.routeError === "string" && data.routeError !== "" ? data.routeError : undefined;
  const { chosen, all } = decisionTargets(flowState, stepId, routes);
  const notTaken = routeError ? [] : all.filter((t) => !chosen.includes(t));
  const info: FlowDecisionInfo = {
    ...(labels ? { labels } : {}),
    routes,
    ...(routeError ? { routeError } : {}),
    chosenTargets: routeError ? [] : chosen,
    notTaken,
  };
  const agents = new Map(flowState.agents);
  const decisionCard = agents.get(stepId);
  if (decisionCard) agents.set(stepId, { ...decisionCard, decision: info });
  const decisions = { ...(flowState.decisions ?? {}), [stepId]: info };
  if (routeError) return { ...flowState, agents, decisions };

  const groups = { ...(flowState.groups ?? {}) };
  const skipped = new Set(flowState.skippedSteps ?? []);
  // Unchosen targets of THIS decision read skipped (overwrites a stale loop
  // result); nothing outside the decision's own targets changes.
  for (const t of notTaken) {
    const card = agents.get(t);
    if (card) agents.set(t, { ...card, status: "skipped" });
    else skipped.add(t);
  }
  for (const r of routes) {
    const t = decisionTargets(flowState, stepId, [r]).chosen[0];
    if (!t) continue;
    skipped.delete(t);
    if (r.itemCount === undefined) continue;
    // A fresh fan-out run: drop stale items; zero items reads skipped.
    groups[t] = [];
    const card = agents.get(t);
    if (card) {
      agents.set(t, {
        ...card,
        status: r.itemCount === 0 ? "skipped" : "pending",
        itemCount: r.itemCount,
        rollup: { ok: 0, failed: 0 },
      });
    }
  }
  return { ...flowState, agents, decisions, groups, skippedSteps: [...skipped] };
}

/** Map a flow-config stepType to a NodeKind for provisional pre-listing at
 *  flow_started. The authoritative nodeKind arrives on the started event. */
function stepTypeToNodeKind(stepType: string | undefined): NodeKind | undefined {
  switch (stepType) {
    case "agent":
    case "agent-decision":
    case "code":
    case "code-decision":
    case "fork":
      return stepType;
    default:
      return undefined;
  }
}

/** Step kinds that render as a card (have no agent but still get a node card). */
function isCardableNonAgentKind(nodeKind: NodeKind | undefined): boolean {
  return nodeKind === "code" || nodeKind === "code-decision";
}

/** Extract a short input preview for tool call display */
function extractToolInputPreview(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const inp = input as Record<string, unknown>;
  switch (toolName.toLowerCase()) {
    case "read":
    case "write":
    case "edit":
      return String(inp.file_path || inp.path || "").split("/").pop() || "";
    case "grep":
      return String(inp.pattern || "").slice(0, 20);
    case "bash":
      return String(inp.command || "").slice(0, 20);
    case "flow_write":
      return String(inp.name || "");
    default:
      return JSON.stringify(input).slice(0, 20);
  }
}

/**
 * Find an agent entry by agentName or stepId.
 * Agents map is keyed by step ID, but events reference by agent name.
 * Also accepts stepId for flow_loop_iteration which uses loopTarget (a step ID).
 * Returns [mapKey, agent] or [undefined, undefined].
 */
function findAgent(
  agents: Map<string, FlowAgentState>,
  nameOrStepId: string,
  stepId?: string,
): [string | undefined, FlowAgentState | undefined] {
  // Direct key lookup (step ID)
  if (agents.has(nameOrStepId)) return [nameOrStepId, agents.get(nameOrStepId)!];
  // If stepId provided, try that
  if (stepId && agents.has(stepId)) return [stepId, agents.get(stepId)!];
  // Search by agentName field
  for (const [key, agent] of agents) {
    if (agent.agentName === nameOrStepId) return [key, agent];
  }
  // Search by stepId field
  for (const [key, agent] of agents) {
    if (agent.stepId === nameOrStepId) return [key, agent];
  }
  return [undefined, undefined];
}

/** Fill the newest open tool entry with its result. */
function withToolResult(history: FlowDetailEntry[], data: Record<string, unknown>): FlowDetailEntry[] {
  const out = [...history];
  for (let i = out.length - 1; i >= 0; i--) {
    const entry = out[i];
    if (entry.kind === "tool" && entry.output === undefined) {
      out[i] = { ...entry, output: data.output, isError: (data.isError as boolean) || false };
      break;
    }
  }
  return out;
}

/** Per-step events ignored once the run is terminal. */
const FROZEN_AFTER_TERMINAL: ReadonlySet<string> = new Set([
  "flow_agent_started",
  "flow_agent_complete",
  "flow_agent_error",
  "flow_tool_call",
  "flow_tool_result",
  "flow_assistant_text",
  "flow_thinking_text",
  "flow_loop_iteration",
  "flow_decision",
]);

/**
 * Returns true if the event type is a flow event handled by this reducer.
 */
export function isFlowEvent(eventType: string): boolean {
  return eventType.startsWith("flow_");
}

/**
 * Reduce a flow event into the current FlowState.
 * Returns null when the event creates a new flow (flow_started).
 * Caller should pass current flowState (may be null).
 */
export function reduceFlowEvent(
  flowState: FlowState | null,
  event: DashboardEvent,
): FlowState | null {
  const data = event.data;

  // A finished run is frozen: late per-step events (a straggling agent
  // complete, tool, text, decision) never change the summary's cards. A new
  // run starts with `flow_started`. See change: update-flows-plugin
  // (flow-summary-view "cards SHALL NOT update afterward").
  if (flowState && flowState.status !== "running" && FROZEN_AFTER_TERMINAL.has(event.eventType)) {
    return flowState;
  }

  switch (event.eventType) {
    case "flow_started": {
      const steps = data.steps as Array<{
        id: string;
        stepType: string;
        agent?: string;
        blockedBy?: string[];
        branches?: Record<string, string>;
        onComplete?: string;
        onError?: string;
      }> | undefined;
      const agents = new Map<string, FlowAgentState>();
      if (steps) {
        for (const step of steps) {
          const nodeKind = stepTypeToNodeKind(step.stepType);
          // Pre-list a pending card for agent-bearing steps AND for code/
          // code-decision steps (which have no agent but still render a card).
          // Keeps the grid consistent live and on replay (task 2.6).
          if (step.agent || isCardableNonAgentKind(nodeKind)) {
            agents.set(step.id, {
              agentName: step.agent || step.id,
              stepId: step.id,
              stepType: step.stepType,
              nodeKind,
              status: "pending",
              blockedBy: step.blockedBy || [],
              recentTools: [],
              detailHistory: [],
            });
          }
        }
      }
      // Store all steps for DAG graph (including non-agent types). `branches`
      // carries decision routing so the live graph can draw branch/loop edges;
      // `onComplete`/`onError` carry forward/error routing so on_complete-wired
      // flows draw `route` edges live (not just in the static Mermaid). Absent
      // fields (older pi-flows) → no route edges, same as before.
      // See change: fix-flow-ui-graph-zoom-summary.
      const dagSteps = steps?.map(step => ({
        id: step.id,
        stepType: step.stepType,
        agent: step.agent,
        blockedBy: step.blockedBy || [],
        branches: step.branches,
        onComplete: step.onComplete,
        onError: step.onError,
      }));

      return {
        flowName: data.flowName as string,
        task: (data.task as string) || "",
        status: "running",
        autonomousMode: (data.autonomousMode as boolean) || false,
        flowSource: (data.source as string) || undefined,
        agents,
        dagSteps,
      };
    }

    case "flow_agent_started": {
      if (!flowState) return null;
      {
        const config = data.config as FlowAgentCardConfig | undefined;
        const viaItem = reduceItemEvent(
          flowState,
          data,
          (item) => ({
            ...item,
            status: "running",
            nodeKind: (data.nodeKind as NodeKind | undefined) ?? item.nodeKind ?? "agent",
            label: config?.card?.label ?? item.label,
            model: config?.model ?? item.model,
            resolvedModel: (data.resolvedModel as string) || item.resolvedModel,
            sourcePath: config?.sourcePath ?? item.sourcePath,
          }),
          { deriveParent: true },
        );
        if (viaItem) {
          // Item count from the producer, when present, sizes the parent.
          const count = data.itemCount;
          const sid = data.stepId as string;
          const parent = viaItem.agents.get(sid);
          if (parent && typeof count === "number" && Number.isFinite(count)) {
            const agents = new Map(viaItem.agents);
            agents.set(sid, { ...parent, itemCount: Math.max(count, parent.itemCount ?? 0) });
            return { ...viaItem, agents };
          }
          return viaItem;
        }
      }
      const agentName = data.agentName as string;
      const stepId = (data.stepId as string) || agentName;
      const config = data.config as FlowAgentCardConfig | undefined;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      const mapKey = key || stepId;
      const isRerun = existing && (existing.status === "complete" || existing.status === "error" || existing.status === "blocked");
      agents.set(mapKey, {
        ...(existing || {
          agentName,
          stepId,
          blockedBy: [],
          recentTools: [],
          detailHistory: [],
        }),
        ...(isRerun ? { recentTools: [], detailHistory: [] } : {}),
        status: "running",
        // nodeKind is decided ONCE here at started (surface-node-kind contract).
        // Fall back to the provisional kind from flow_started, else "agent".
        nodeKind: (data.nodeKind as NodeKind | undefined) ?? existing?.nodeKind ?? "agent",
        // Resolved handler target for code / code-decision nodes (started only).
        codeTarget: (data.target as string | undefined) ?? existing?.codeTarget,
        label: config?.card?.label,
        model: config?.model,
        resolvedModel: (data.resolvedModel as string) || undefined,
        cardRole: config?.card?.role,
        sourcePath: config?.sourcePath,
        runCount: isRerun ? (existing.runCount ?? 1) + 1 : (existing?.runCount ?? 1),
      });
      return { ...flowState, agents };
    }

    case "flow_agent_complete": {
      if (!flowState) return null;
      const result = data.result as {
        success: boolean;
        status?: string;
        summary?: string;
        files?: string[];
        tokens?: { input: number; output: number };
        cost?: number;
        duration?: number;
        outcome?: "success" | "soft" | "hard";
        typedOutputs?: Record<string, string>;
      } | undefined;
      const completed = (existing: FlowAgentState): FlowAgentState => {
        const typedOutputs = result?.typedOutputs;
        const outcome =
          result?.outcome ?? (data.outcome as "success" | "soft" | "hard" | undefined) ??
          (result?.success ? "success" : "soft");
        return {
          ...existing,
          status: result?.status === "blocked" ? "blocked" : result?.success ? "complete" : "error",
          tokens: result?.tokens,
          cost: result?.cost,
          duration: result?.duration,
          summary: result?.summary,
          files: result?.files,
          outcome,
          typedOutputs,
          branch: typedOutputs?.branch ?? (data.branch as string | undefined) ?? existing.branch,
        };
      };
      const viaItem = reduceItemEvent(flowState, data, completed, { deriveParent: true });
      if (viaItem) return viaItem;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const typedOutputs = result?.typedOutputs;
        // outcome may ride on the result or the event data; default success.
        const outcome =
          result?.outcome ?? (data.outcome as "success" | "soft" | "hard" | undefined) ??
          (result?.success ? "success" : "soft");
        agents.set(key, {
          ...existing,
          status: result?.status === "blocked" ? "blocked" : result?.success ? "complete" : "error",
          tokens: result?.tokens,
          cost: result?.cost,
          duration: result?.duration,
          summary: result?.summary,
          files: result?.files,
          outcome,
          typedOutputs,
          // code-decision exposes the chosen branch via typedOutputs.branch.
          branch: typedOutputs?.branch ?? (data.branch as string | undefined) ?? existing.branch,
        });
      }
      return { ...flowState, agents };
    }

    case "flow_tool_call": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const toolName = data.toolName as string;
      const input = data.input;
      const viaItem = reduceItemEvent(
        flowState,
        data,
        (item) => ({
          ...item,
          recentTools: [...item.recentTools, { toolName, inputPreview: extractToolInputPreview(toolName, input) }].slice(-3),
          detailHistory: [...item.detailHistory, { kind: "tool", toolName, input, isError: false }],
        }),
        { deriveParent: false },
      );
      if (viaItem) return viaItem;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const preview = extractToolInputPreview(toolName, input);
        const recentTools: FlowRecentTool[] = [
          ...existing.recentTools,
          { toolName, inputPreview: preview },
        ].slice(-3);
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "tool", toolName, input, isError: false },
        ];
        agents.set(key, { ...existing, recentTools, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_tool_result": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const viaItem = reduceItemEvent(
        flowState,
        data,
        (item) => ({ ...item, detailHistory: withToolResult(item.detailHistory, data) }),
        { deriveParent: false },
      );
      if (viaItem) return viaItem;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const detailHistory = [...existing.detailHistory];
        for (let i = detailHistory.length - 1; i >= 0; i--) {
          const entry = detailHistory[i];
          if (entry.kind === "tool" && entry.output === undefined) {
            detailHistory[i] = {
              ...entry,
              output: data.output,
              isError: (data.isError as boolean) || false,
            };
            break;
          }
        }
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_assistant_text": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const text = data.text as string;
      if (!text) return flowState;
      const viaItem = reduceItemEvent(
        flowState,
        data,
        (item) => ({ ...item, detailHistory: [...item.detailHistory, { kind: "text", text }] }),
        { deriveParent: false },
      );
      if (viaItem) return viaItem;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "text", text },
        ];
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_thinking_text": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const text = data.text as string;
      if (!text) return flowState;
      const viaItem = reduceItemEvent(
        flowState,
        data,
        (item) => ({ ...item, detailHistory: [...item.detailHistory, { kind: "thinking", text }] }),
        { deriveParent: false },
      );
      if (viaItem) return viaItem;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "thinking", text },
        ];
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_agent_error": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const text = data.text as string;
      if (!text) return flowState;
      // Item error: append to the item timeline; status stays owned by complete.
      const viaItem = reduceItemEvent(
        flowState,
        data,
        (item) => ({ ...item, detailHistory: [...item.detailHistory, { kind: "error", text }] }),
        { deriveParent: false },
      );
      if (viaItem) return viaItem;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        // Append an error entry to the agent timeline. Status is owned by
        // flow_agent_complete — do not change it here.
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "error", text },
        ];
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_loop_iteration": {
      if (!flowState) return null;
      const loopTarget = data.loopTarget as string;
      const iteration = data.iteration as number;
      const maxIterations = data.maxIterations as number;
      if (!loopTarget) return flowState;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, loopTarget);
      if (key && existing) {
        agents.set(key, {
          ...existing,
          loopIteration: iteration,
          loopMax: maxIterations,
        });
      }
      return { ...flowState, agents };
    }

    case "flow_auto_decision": {
      return flowState;
    }

    case "flow_decision": {
      if (!flowState) return null;
      return reduceDecision(flowState, data);
    }

    case "flow_complete": {
      if (!flowState) return null;
      // A rejected start (pi-flows refused to run; no flow_started was emitted)
      // never refers to the run held here — leave it untouched.
      // See change: attach-flow-before-run (D10).
      if (data.status === "rejected") return flowState;
      const status = ((data.status as string) || "success") as FlowState["status"];
      // When the flow ends non-successfully (error / aborted / interrupted),
      // downgrade any step left running/pending so its card does not spin
      // forever (task 3.6; covers the synthesized interrupted terminal).
      // `skipped` is never downgraded (only running / pending are).
      let agents = flowState.agents;
      let groups = flowState.groups;
      if (status !== "success") {
        const downgrade = (a: FlowAgentState): FlowAgentState =>
          a.status === "running" || a.status === "pending"
            ? { ...a, status: "error", outcome: a.outcome ?? "hard" }
            : a;
        agents = new Map(flowState.agents);
        for (const [k, a] of agents) agents.set(k, downgrade(a));
        if (flowState.groups) {
          groups = {};
          for (const [sid, items] of Object.entries(flowState.groups)) {
            groups[sid] = items.map((i) => (i ? downgrade(i) : i));
            if (groups[sid].length > 0) withDerivedParent(agents, sid, groups[sid]);
          }
        }
      }
      return {
        ...flowState,
        status,
        agents,
        ...(groups ? { groups } : {}),
        flowResult: data as Record<string, unknown>,
      };
    }

    case "flow_summary_ready": {
      if (!flowState) return null;
      return {
        ...flowState,
        nextStep: (data.nextStep as string | null) ?? null,
        summaryStats: data.stats as FlowState["summaryStats"],
      };
    }

    case "flow_summary_dismissed": {
      return null;
    }

    case "flow_autonomous_changed": {
      if (!flowState) return null;
      return {
        ...flowState,
        autonomousMode: (data.enabled as boolean) ?? flowState.autonomousMode,
      };
    }

    default:
      return flowState;
  }
}
