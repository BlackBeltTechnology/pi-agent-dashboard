/**
 * Subagent orphan heal, owned by the plugin. On every session end reported by
 * `ctx.onSessionStatusEnded` (unregister, status set to ended, end-reason
 * re-fire; never a relocation) it appends a synthesized `subagent_failed` for
 * every subagent that was created/started and never reached a terminal frame.
 *
 * Idempotent by construction: the appended `subagent_failed` lands in the same
 * stream, so a re-fired end finds nothing open. NOT turn-scoped (a subagent
 * outlives one `agent_start`) and independent of any tool-call `agentId`.
 *
 * Moved from core `session/open-tool-calls.ts`.
 * See change: move-subagents-to-plugin (D4).
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const SESSION_ENDED_RESULT = "parent session ended";
const SESSION_ENDED_MARKER = "session_ended";

/** Minimal shape of a stored event (`{ seq, event }`). */
export interface StoredEventLike {
  event: DashboardEvent;
}

/** Subagents created/started with no terminal event, in first-seen order. */
export function findOpenSubagents(events: readonly StoredEventLike[]): string[] {
  const seen: string[] = [];
  const known = new Set<string>();
  const terminal = new Set<string>();

  for (const { event } of events) {
    const id = event.data?.id;
    if (typeof id !== "string") continue;
    if (event.eventType === "subagent_created" || event.eventType === "subagent_started") {
      if (!known.has(id)) {
        known.add(id);
        seen.push(id);
      }
    } else if (event.eventType === "subagent_completed" || event.eventType === "subagent_failed") {
      terminal.add(id);
    }
  }

  return seen.filter((id) => !terminal.has(id));
}

/** The synthesized `subagent_failed` that terminates an orphaned subagent. */
export function synthesizeSessionEndedSubagentFail(id: string, now: number): DashboardEvent {
  return {
    eventType: "subagent_failed",
    timestamp: now,
    data: { id, error: SESSION_ENDED_RESULT, healedBy: SESSION_ENDED_MARKER },
  };
}

/** Subscribe the heal to the status-ended seam. Returns the unsubscribe fn. */
export function registerSessionEndHeal(
  ctx: Pick<ServerPluginContext, "onSessionStatusEnded" | "eventStore" | "appendEvent" | "logger">,
): () => void {
  return ctx.onSessionStatusEnded((sessionId) => {
    try {
      const stored = ctx.eventStore.getEvents(sessionId) as StoredEventLike[];
      const now = Date.now();
      for (const id of findOpenSubagents(stored)) {
        ctx.appendEvent(sessionId, synthesizeSessionEndedSubagentFail(id, now));
      }
    } catch (err) {
      ctx.logger.warn(`subagent session-end heal failed for ${sessionId}:`, err instanceof Error ? err.message : err);
    }
  });
}
