/**
 * Flow types — owned by the flows plugin (moved out of
 * `packages/shared/src/types.ts`; core holds no flow type). The plugin keeps its
 * per-session slice through its registered session-event reducer and the
 * server `state-store.ts`.
 *
 * pi-flows 0.10 additions (design D6): `skipped` status (untaken / unchosen
 * branch), fan-out item cards keyed `<stepId>[<i>]` grouped under
 * `FlowState.groups`, and a decision's chosen routes on its card.
 * See change: update-flows-plugin (D5, D6).
 */
import type { FlowDetailEntry, FlowRecentTool } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Shared with the core architect state (not flow-run specific); re-exported.
export type { FlowDetailEntry, FlowRecentTool };

/** Status of a flow agent card */
export type FlowAgentStatus = "pending" | "running" | "complete" | "error" | "blocked" | "skipped";

/** Agent card config from pi-flows AgentConfig (minimal subset) */
export interface FlowAgentCardConfig {
  name: string;
  description?: string;
  model?: string;
  card?: { label?: string; metric?: string; role?: string };
  sourcePath?: string;
}

/** First-class node-kind discriminator emitted by every pi-flows executor.
 *  Decided once at the node's started event; carried on the event payload so it
 *  persists + replays. Distinct from FlowDetailEntry.kind (text|thinking|tool|error).
 *  See change: rework-flows-plugin-for-new-pi-flows (consumes pi-flows surface-node-kind). */
export type NodeKind =
  | "agent"
  | "agent-decision"
  | "code"
  | "code-decision"
  | "fork";

/** Per-agent (per-step) state tracked in flow state */
export interface FlowAgentState {
  agentName: string;
  stepId: string;
  /** Step type from the flow config (agent, fork, agent-decision, etc.) */
  stepType?: string;
  /** Node-kind from the lifecycle started event; selects the card renderer. */
  nodeKind?: NodeKind;
  /** Failure outcome from the completion event: routed-soft vs flow-halting-hard. */
  outcome?: "success" | "soft" | "hard";
  /** Typed outputs from the completion event (code/agent contract). */
  typedOutputs?: Record<string, string>;
  /** Chosen branch label for code-decision / agent-decision nodes. */
  branch?: string;
  /** Resolved handler target path for code / code-decision nodes (from started). */
  codeTarget?: string;
  status: FlowAgentStatus;
  label?: string;
  model?: string;
  resolvedModel?: string;
  cardRole?: string;
  blockedBy: string[];
  tokens?: { input: number; output: number };
  /** Accumulated per-agent USD cost from `flow_agent_complete` (`result.cost`).
   *  Sibling of `tokens`; `undefined` when the session predates cost surfacing. */
  cost?: number;
  duration?: number;
  summary?: string;
  files?: string[];
  recentTools: FlowRecentTool[];
  detailHistory: FlowDetailEntry[];
  loopIteration?: number;
  loopMax?: number;
  sourcePath?: string;
  runCount?: number;
  /** Fan-out item card: 0-based item index and its key `<stepId>[<i>]`. */
  itemIndex?: number;
  itemKey?: string;
  /** Fan-out group parent: item count and ok / failed rollup (derived). */
  itemCount?: number;
  rollup?: { ok: number; failed: number };
  /** Multi-route decision (pi-flows 0.10 `flow_decision`): chosen labels,
   *  chosen routes (with fan-out item counts) and a post-routing error. */
  decision?: FlowDecisionInfo;
}

/** What a `flow_decision` stored for one decision step. */
export interface FlowDecisionInfo {
  labels?: string[];
  routes?: Array<{ branch: string; itemCount?: number }>;
  routeError?: string;
  /** Resolved chosen target step ids (route branch → `branches` target). */
  chosenTargets: string[];
  /** Branch targets of this decision that were not chosen. */
  notTaken: string[];
}

/** Overall flow execution status. `interrupted` = orphaned run reconciled on resume
 *  (pi-flows clear-orphaned synthesized terminal). */
export type FlowStatus = "running" | "success" | "error" | "aborted" | "interrupted";

/** Flow execution state tracked client-side by the event reducer */
export interface FlowState {
  flowName: string;
  task: string;
  status: FlowStatus;
  autonomousMode: boolean;
  /** Path to the flow YAML file (for YAML viewer) */
  flowSource?: string;
  /** Ordered map — insertion order matches step order from flow config */
  agents: Map<string, FlowAgentState>;
  /** All steps from the flow configuration — used for DAG graph rendering.
   *  Includes non-agent steps (fork, agent-decision, code-decision). `branches`
   *  carries decision routing (label → target) emitted by `flow:flow-started`. */
  dagSteps?: Array<{ id: string; stepType: string; agent?: string; blockedBy: string[]; branches?: Record<string, string>; onComplete?: string; onError?: string }>;
  /** Set after flow_complete event */
  flowResult?: Record<string, unknown>;
  /** Fan-out groups: step id → item cards in item order (`<stepId>[<i>]`).
   *  The pre-listed step card is the group parent. pi-flows ≥ 0.10. */
  groups?: Record<string, FlowAgentState[]>;
  /** Decision step id → its last `flow_decision`. pi-flows ≥ 0.10. */
  decisions?: Record<string, FlowDecisionInfo>;
  /** Steps marked skipped that have no card (non-agent targets). */
  skippedSteps?: string[];

  /** Next flow to run (workflow stage resolution) */
  nextStep?: string | null;
  /** Pre-computed summary stats */
  summaryStats?: {
    agentCount: number;
    duration: string;
    fileCount: number;
    perAgent: Array<{ name: string; status: string; fileCount: number }>;
  };
}
