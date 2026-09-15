/**
 * Pure derivation of what a dying session left open, plus the synthesized
 * terminal events that heal it.
 *
 * The server tracks `currentTool` as a single string, so the only durable
 * record of which tool calls / subagents were in flight is the stored event
 * stream. When a session reaches its terminal transition, `onEnded` derives the
 * open set from `eventStore.getEvents(sessionId, 1)` and inserts one
 * synthesized terminal event per entry, making the stream self-describing: the
 * reducer's existing `tool_execution_end` / `subagent_failed` arms do the work,
 * live and on replay.
 *
 * Idempotence comes from the store, not a flag: the synthesized ends land in
 * the same stream, so a second derivation finds nothing open.
 *
 * See change: heal-orphaned-tool-cards-on-session-end (design D2, D3, D3b).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";

/** Result text + `healedBy` marker carried by every event synthesized here. */
const SESSION_ENDED_RESULT = "parent session ended";
const SESSION_ENDED_MARKER = "session_ended";

export interface OpenToolCall {
  toolCallId: string;
  toolName: string;
  /** Only for `Agent` calls that ever ticked a subagent snapshot. */
  agentId?: string;
}

/**
 * Tool calls started but never ended within the LAST turn.
 *
 * Turn-scoped (backwards walk stopping at the most recent `agent_start`):
 * earlier turns are already terminal via real ends or the superseded heal, so
 * reopening them would duplicate ends. A stream whose `agent_start` was trimmed
 * (or that never had one) is treated as a single turn — still correct, since an
 * end always follows its start.
 *
 * KNOWN GAP: the bridge emits a synthetic bare `agent_start` after a mid-turn
 * reconnect (`extension/src/bridge.ts`), indistinguishable from a real one, so a
 * call opened before that reconnect falls outside the scope and is not healed
 * live. The transcript orphan-close (`shared/src/state-replay.ts`) is NOT
 * turn-scoped and still heals it on the next cold hydration.
 */
export function findOpenToolCalls(events: StoredEvent[]): OpenToolCall[] {
  const closed = new Set<string>();
  const agentIds = new Map<string, string>();
  const open: OpenToolCall[] = [];

  for (let i = events.length - 1; i >= 0; i--) {
    const { eventType, data } = events[i].event;
    if (eventType === "agent_start") break;
    if (eventType === "tool_execution_end") {
      const id = data.toolCallId;
      if (typeof id === "string") closed.add(id);
      continue;
    }
    if (eventType === "tool_execution_update") {
      const id = data.toolCallId;
      if (typeof id !== "string" || agentIds.has(id)) continue;
      // The Agent snapshot rides `data.partialResult.details.agentId` — the
      // path the reducer and the bridge's frame-strip both use. `data.details`
      // carries nothing here.
      const partial = data.partialResult as Record<string, unknown> | undefined;
      const details = partial?.details as Record<string, unknown> | undefined;
      if (typeof details?.agentId === "string") agentIds.set(id, details.agentId);
      continue;
    }
    if (eventType === "tool_execution_start") {
      const id = data.toolCallId;
      if (typeof id !== "string" || closed.has(id)) continue;
      open.push({
        toolCallId: id,
        toolName: typeof data.toolName === "string" ? data.toolName : "",
      });
    }
  }

  // Walked backwards; report in start order.
  open.reverse();
  return open.map((call) => {
    const agentId = agentIds.get(call.toolCallId);
    return agentId ? { ...call, agentId } : call;
  });
}

/**
 * Subagents created/started with no terminal event.
 *
 * NOT turn-scoped — a subagent outlives a single `agent_start` — and
 * independent of the tool-call scan: a subagent whose `agentId` never reached a
 * `tool_execution_update` (dropped ticks) is reachable only here.
 */
export function findOpenSubagents(events: StoredEvent[]): string[] {
  const seen: string[] = [];
  const known = new Set<string>();
  const terminal = new Set<string>();

  for (const { event } of events) {
    const id = event.data.id;
    if (typeof id !== "string") continue;
    if (event.eventType === "subagent_created" || event.eventType === "subagent_started") {
      if (!known.has(id)) {
        known.add(id);
        seen.push(id);
      }
    } else if (
      event.eventType === "subagent_completed" ||
      event.eventType === "subagent_failed"
    ) {
      terminal.add(id);
    }
  }

  return seen.filter((id) => !terminal.has(id));
}

/** The synthesized `tool_execution_end` that terminates an orphaned card. */
export function synthesizeSessionEndedEnd(call: OpenToolCall, now: number): DashboardEvent {
  return {
    eventType: "tool_execution_end",
    timestamp: now,
    data: {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      isError: true,
      result: SESSION_ENDED_RESULT,
      healedBy: SESSION_ENDED_MARKER,
      ...(call.agentId ? { details: { agentId: call.agentId } } : {}),
    },
  };
}

/** The synthesized `subagent_failed` that terminates an orphaned subagent. */
export function synthesizeSessionEndedSubagentFail(id: string, now: number): DashboardEvent {
  return {
    eventType: "subagent_failed",
    timestamp: now,
    data: { id, error: SESSION_ENDED_RESULT, healedBy: SESSION_ENDED_MARKER },
  };
}
