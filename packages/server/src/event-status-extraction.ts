/**
 * Extract session status/tool updates from forwarded events.
 * Returns partial DashboardSession updates, or null if the event is not relevant.
 */
import type { DashboardEvent, DashboardSession, FlowStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Use null (not undefined) for fields that must be cleared — undefined is
// dropped during JSON serialisation so the browser would keep the stale value.
type SessionUpdates = Partial<Pick<DashboardSession, "status" | "model" | "thinkingLevel">> & {
  currentTool?: string | null;
  activeFlowName?: string | null;
  flowAgentsDone?: number;
  flowAgentsTotal?: number;
  flowStatus?: FlowStatus | null;
};

/**
 * Accumulate token/cost stats from a batch of events (e.g. loaded from disk).
 * Returns partial session updates with totals, or null if no stats found.
 */
export function extractStatsFromEvents(
  events: Array<{ eventType: string; data: Record<string, unknown> }>,
): Partial<DashboardSession> | null {
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let contextTokens: number | undefined;
  let contextWindow: number | undefined;
  let found = false;

  for (const evt of events) {
    if (evt.eventType !== "stats_update") continue;
    found = true;
    const d = evt.data;
    if (d.tokensIn) tokensIn += d.tokensIn as number;
    if (d.tokensOut) tokensOut += d.tokensOut as number;
    if (d.cost) cost += d.cost as number;
    const turn = d.turnUsage as { cacheRead?: number; cacheWrite?: number } | undefined;
    if (turn) {
      if (turn.cacheRead) cacheRead += turn.cacheRead;
      if (turn.cacheWrite) cacheWrite += turn.cacheWrite;
    }
    const ctx = d.contextUsage as { tokens?: number | null; contextWindow?: number } | undefined;
    if (ctx) {
      if (ctx.tokens != null) contextTokens = ctx.tokens;
      if (ctx.contextWindow) contextWindow = ctx.contextWindow;
    }
  }

  if (!found) return null;
  const updates: Partial<DashboardSession> = { tokensIn, tokensOut, cacheRead, cacheWrite, cost };
  if (contextTokens !== undefined) updates.contextTokens = contextTokens;
  if (contextWindow !== undefined) updates.contextWindow = contextWindow;
  return updates;
}

export function extractSessionUpdates(event: DashboardEvent): SessionUpdates | null {
  switch (event.eventType) {
    case "agent_start":
      return { status: "streaming", currentTool: null };

    case "agent_end":
      return { status: "idle", currentTool: null };

    case "tool_execution_start":
      return { currentTool: (event.data.toolName as string) ?? null };

    case "tool_execution_end":
      return { currentTool: null };

    case "model_select": {
      const model = event.data.model as { provider?: string; id?: string } | undefined;
      if (model?.provider && model?.id) {
        const updates: SessionUpdates = { model: `${model.provider}/${model.id}` };
        const thinkingLevel = event.data.thinkingLevel as string | undefined;
        if (thinkingLevel !== undefined) {
          updates.thinkingLevel = thinkingLevel;
        }
        return updates;
      }
      return null;
    }

    // ── Flow events ──
    case "flow_started": {
      const d = event.data;
      const steps = d.steps as Array<{ stepType: string }> | undefined;
      const agentCount = steps?.filter(s => s.stepType === "agent").length ?? 0;
      return {
        activeFlowName: (d.flowName as string) ?? null,
        flowAgentsTotal: agentCount,
        flowAgentsDone: 0,
        flowStatus: "running" as FlowStatus,
      };
    }

    case "flow_agent_complete":
      // Increment is handled by the caller — we return a marker
      return { flowAgentsDone: -1 }; // sentinel: caller must increment

    case "flow_complete": {
      const result = event.data;
      const status = (result.status as string) ?? "success";
      return {
        flowStatus: status as FlowStatus,
      };
    }

    // ── Architect events ──
    case "architect_started": {
      const mode = (event.data.mode as string) || "new";
      return {
        activeFlowName: mode === "edit" ? "Editing flow..." : "Designing flow...",
        flowStatus: "running" as FlowStatus,
      };
    }

    case "flow_summary_dismissed": {
      return {
        activeFlowName: null,
        flowStatus: null,
      };
    }

    case "architect_complete":
    case "architect_cancelled": {
      return {
        activeFlowName: null,
        flowStatus: null,
      };
    }

    default:
      return null;
  }
}

/**
 * Activity-event allowlist for `session.lastActivityAt` stamping.
 *
 * Returns `true` for event types that represent user-or-agent action
 * (the kind of thing a human would call "this session did something"),
 * and `false` for plumbing/heartbeat/UI-state noise.
 *
 * The allowlist is deliberately narrow. Adding a new pi event type that
 * a user would consider "activity" requires adding it here.
 *
 * See change: session-card-last-activity-badge (design.md § "Activity-event allowlist").
 */
const ACTIVITY_EVENT_TYPES: ReadonlySet<string> = new Set([
  // User input
  "prompt_send",
  // Assistant message lifecycle
  "message_start",
  "message_end",
  "turn_end",
  // Tool execution
  "tool_execution_start",
  "tool_execution_end",
  // Agent lifecycle
  "agent_start",
  "agent_end",
  // Bash command output
  "bash_output",
  // Flow lifecycle / agent steps
  "flow_started",
  "flow_complete",
  "flow_agent_started",
  "flow_agent_complete",
  // Architect (flow design) lifecycle
  "architect_started",
  "architect_complete",
  "architect_cancelled",
]);

export function isActivityEvent(eventType: string): boolean {
  return ACTIVITY_EVENT_TYPES.has(eventType);
}
