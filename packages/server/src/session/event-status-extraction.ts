/**
 * Extract session status/tool updates from forwarded events.
 * Returns partial DashboardSession updates, or null if the event is not relevant.
 */
import type { DashboardEvent, DashboardSession, SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Use null (not undefined) for fields that must be cleared — undefined is
// dropped during JSON serialisation so the browser would keep the stale value.
type SessionUpdates = Partial<Pick<DashboardSession, "status" | "model" | "thinkingLevel">> & {
  currentTool?: string | null;
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

    // Flow / architect events are NOT extracted here. Per change
    // pluginize-flows-via-registry, flows-plugin owns its own state
    // derivation in the browser via useSessionEvents + plugin-internal
    // contexts. The dashboard server has zero flow knowledge.

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
]);
// Note: flow / architect events used to live in this allowlist but the
// classification of "is this user-visible activity?" is plugin business.
// The plugin marks activity via its own session-state-derived signal
// (e.g. lastActivityAt stamping based on flowState changes). For now,
// the simpler tool/agent/message events are sufficient to keep
// `lastActivityAt` accurate; if a flow that does no other tool calls
// fails to bump activity, the user can re-add the events here behind a
// generic predicate like `isPluginActivityEvent` exposed by plugin-runtime.
// See change: pluginize-flows-via-registry.

export function isActivityEvent(eventType: string): boolean {
  return ACTIVITY_EVENT_TYPES.has(eventType);
}

/**
 * Snapshot of the session fields the unread classifier needs.
 * Pulled out of `DashboardSession` to keep the helper testable without
 * constructing a full session object.
 */
export interface UnreadTriggerSnapshot {
  status?: SessionStatus;
  currentTool?: string | null;
}

/**
 * Pure classifier: should the given event flip a session to `unread: true`?
 *
 * Triggers (per change: session-card-unread-stripes):
 *   1. status transition `streaming` -> `idle` or `streaming` -> `active`
 *      (turn finished)
 *   2. `currentTool` becomes `"ask_user"` (input requested)
 *   3. `agent_end` event whose payload's `error` field is truthy
 *
 * Anything else (assistant message_end, tool_execution_*, model_select,
 * git/process noise) returns false. This is intentionally narrower than
 * `isActivityEvent` — unread is for moments that demand the user’s eyes,
 * not every tick of work.
 *
 * The caller is responsible for the "not currently viewed" gate — this
 * helper is concerned only with whether the event semantically qualifies.
 */
export function isUnreadTrigger(
  eventType: string,
  before: UnreadTriggerSnapshot,
  after: UnreadTriggerSnapshot,
  payload?: unknown,
): boolean {
  // Trigger 1: streaming -> idle | active (turn fully finished)
  if (
    before.status === "streaming" &&
    (after.status === "idle" || after.status === "active")
  ) {
    return true;
  }

  // Trigger 2: currentTool flips to "ask_user"
  if (after.currentTool === "ask_user" && before.currentTool !== "ask_user") {
    return true;
  }

  // Trigger 3: agent_end with error
  if (eventType === "agent_end") {
    const data = (payload as { error?: unknown } | undefined) ?? undefined;
    if (data && data.error) return true;
  }

  return false;
}
