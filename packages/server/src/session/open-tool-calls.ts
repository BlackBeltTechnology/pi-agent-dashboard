/**
 * Pure derivation of what a dying session left open, plus the synthesized
 * terminal events that heal it.
 *
 * The server tracks `currentTool` as a single string, so the only durable
 * record of which tool calls / subagents were in flight is the stored event
 * stream. When a session reaches its terminal transition, `onEnded` derives the
 * open set from `eventStore.getEvents(sessionId, 1)` and inserts one
 * synthesized terminal event per entry, making the stream self-describing: the
 * reducer's existing `tool_execution_end` arm does the work,
 * live and on replay.
 *
 * Idempotence comes from the store, not a flag: the synthesized ends land in
 * the same stream, so a second derivation finds nothing open.
 *
 * Subagent orphan heal (open subagents → a synthesized terminal frame) lives in
 * the subagents plugin (`ctx.onSessionStatusEnded`); this module names no plugin
 * contract. See change: move-subagents-to-plugin (D4).
 *
 * See change: heal-orphaned-tool-cards-on-session-end (design D2, D3, D3b).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { sanitizeIdentityFields } from "../plugin-policy-registry.js";

/** Result text + `healedBy` marker carried by every event synthesized here. */
const SESSION_ENDED_RESULT = "parent session ended";
const SESSION_ENDED_MARKER = "session_ended";

/**
 * Recovers a claimed tool's identity fields from one of its
 * `tool_execution_update` events: the claiming plugin's store-policy `identity`
 * hook (an end-shaped partial `data`), or `undefined` for an unclaimed tool.
 */
export type ToolIdentityResolver = (
  toolName: string,
  update: DashboardEvent,
) => Record<string, unknown> | undefined;

export interface OpenToolCall {
  toolCallId: string;
  toolName: string;
  /**
   * Scalar identity fields the claiming plugin's policy recovered from the
   * call's latest identity-bearing update; merged into the synthesized end.
   */
  identity?: Record<string, unknown>;
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
 * The bridge re-announces a running turn after a reconnect / reload replay with
 * an `agent_start` marked `synthetic: true` (`extension/src/bridge.ts`,
 * `bridge-handlers/lifecycle.ts`). It is not a turn boundary: the walk passes
 * it, so calls the live replay left open stay in scope and heal on real death.
 * An OLD bridge sends the start unmarked — then a call opened before the
 * reconnect falls outside the scope; the transcript orphan-close
 * (`shared/src/state-replay.ts`, cold path) still heals it on the next cold
 * hydration. Open starts are deduped by `toolCallId`.
 * See change: fix-replay-fabricates-orphan-end-for-live-calls (D4).
 */
export function findOpenToolCalls(
  events: StoredEvent[],
  resolveIdentity?: ToolIdentityResolver,
): OpenToolCall[] {
  const closed = new Set<string>();
  // Updates per call, NEWEST first; consulted only for calls found open.
  const updates = new Map<string, DashboardEvent[]>();
  const open: OpenToolCall[] = [];

  for (let i = events.length - 1; i >= 0; i--) {
    const { eventType, data } = events[i].event;
    if (eventType === "agent_start") {
      if (data?.synthetic === true) continue;
      break;
    }
    if (eventType === "tool_execution_end") {
      const id = data.toolCallId;
      if (typeof id === "string") closed.add(id);
      continue;
    }
    if (eventType === "tool_execution_update") {
      const id = data.toolCallId;
      if (!resolveIdentity || typeof id !== "string") continue;
      const list = updates.get(id);
      if (list) list.push(events[i].event);
      else updates.set(id, [events[i].event]);
      continue;
    }
    if (eventType === "tool_execution_start") {
      const id = data.toolCallId;
      if (typeof id !== "string" || closed.has(id)) continue;
      // Defensive dedupe: report each open call once.
      closed.add(id);
      // Nested calls (`parentToolCallId`) are rendered inside their root and
      // are never healed top-level. See change: render-nested-tool-calls (D2).
      if (typeof data.parentToolCallId === "string" && data.parentToolCallId !== "") continue;
      open.push({
        toolCallId: id,
        toolName: typeof data.toolName === "string" ? data.toolName : "",
      });
    }
  }

  // Walked backwards; report in start order.
  open.reverse();
  if (!resolveIdentity) return open;
  return open.map((call) => {
    for (const update of updates.get(call.toolCallId) ?? []) {
      let identity: Record<string, unknown> | undefined;
      try {
        identity = sanitizeIdentityFields(resolveIdentity(call.toolName, update));
      } catch {
        identity = undefined;
      }
      if (identity) return { ...call, identity };
    }
    return call;
  });
}

/**
 * Which backfill-served top-level starts are still open at serve time.
 *
 * `suffix` is the store from the served slice's lower bound onward. A
 * candidate is open iff, after its top-level `tool_execution_start`, the
 * suffix holds none of: its top-level `tool_execution_end` (real or healed), a
 * non-synthetic `agent_start` (earlier turn), an `agent_end` (turn over), or
 * an assistant `message_start` (pi infers again only after every tool of the
 * previous inference ended, so a later inference proves the end was lost).
 *
 * Narrower than `findOpenToolCalls`, which must stay turn-scoped and wide for
 * the session-end heal. Nested starts (`parentToolCallId`) are never open.
 * Result keeps candidate order.
 * See change: fix-backfill-elides-live-tools (D1).
 */
export function findBackfillOpenToolCalls(
  candidateIds: readonly string[],
  suffix: readonly StoredEvent[],
): string[] {
  if (candidateIds.length === 0) return [];
  const candidates = new Set(candidateIds);
  const closed = new Set<string>();
  const open = new Set<string>();
  // Backwards walk. The first boundary met (the LATEST in the stream) closes
  // every start before it, so the walk stops there.
  for (let i = suffix.length - 1; i >= 0; i--) {
    const { eventType, data } = suffix[i].event;
    const nested = typeof data?.parentToolCallId === "string" && data.parentToolCallId !== "";
    if (eventType === "agent_start" && data?.synthetic !== true) break;
    if (eventType === "agent_end") break;
    if (
      eventType === "message_start" &&
      (data?.message as { role?: unknown } | undefined)?.role === "assistant"
    ) {
      break;
    }
    if (nested) continue;
    const id = data?.toolCallId;
    if (typeof id !== "string") continue;
    if (eventType === "tool_execution_end") closed.add(id);
    else if (eventType === "tool_execution_start" && candidates.has(id) && !closed.has(id)) open.add(id);
  }
  return candidateIds.filter((id) => open.has(id));
}

/** The synthesized `tool_execution_end` that terminates an orphaned card. */
export function synthesizeSessionEndedEnd(call: OpenToolCall, now: number): DashboardEvent {
  return {
    eventType: "tool_execution_end",
    timestamp: now,
    data: {
      // Owner identity first: the core fields below can never be overridden.
      ...(call.identity ?? {}),
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      isError: true,
      result: SESSION_ENDED_RESULT,
      healedBy: SESSION_ENDED_MARKER,
    },
  };
}
