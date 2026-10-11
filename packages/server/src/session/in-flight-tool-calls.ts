/**
 * Live-only, in-memory hint of which top-level tool calls are running.
 *
 * Feeds ONLY the `202` vs `404` choice of `GET /api/session/:id/tool-result/:id?pending=1`.
 * Never vouches "gone": that answer comes solely from the store's evicted-end
 * record. A stale or missing entry is cosmetic (`202` instead of `404`, or the
 * reverse) — the client finalizes nothing on a `202` (it counts like a `404`).
 *
 * Fed only from the live (non-replaying) event-forward branch, so a replayed
 * end/`agent_settled` (which can describe a call that is still running) never
 * reaches it. Cleared on `agent_settled`, every `session_register`, session end
 * and session removal.
 *
 * See change: distinguish-tool-result-pending-vs-gone (D2).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const MAX_IDS_PER_SESSION = 256;

export interface InFlightToolCalls {
  /** Feed one LIVE event; replayed events must never be passed here. */
  observeLive(sessionId: string, event: DashboardEvent): void;
  isInFlight(sessionId: string, toolCallId: string): boolean;
  /** Forget everything known about a session. */
  clear(sessionId: string): void;
  /** Test probes. */
  sessionCount(): number;
  idCount(sessionId: string): number;
}

export function createInFlightToolCalls(): InFlightToolCalls {
  const bySession = new Map<string, Set<string>>();

  return {
    observeLive(sessionId, event) {
      const { eventType, data } = event;
      if (eventType === "agent_settled") {
        bySession.delete(sessionId);
        return;
      }
      if (eventType !== "tool_execution_start" && eventType !== "tool_execution_end") return;
      const id = data?.toolCallId;
      if (typeof id !== "string") return;

      if (eventType === "tool_execution_end") {
        const set = bySession.get(sessionId);
        if (!set) return;
        set.delete(id);
        if (set.size === 0) bySession.delete(sessionId);
        return;
      }

      // Nested calls render inside their root and are never reconciled.
      if (typeof data.parentToolCallId === "string" && data.parentToolCallId !== "") return;
      let set = bySession.get(sessionId);
      if (!set) {
        set = new Set();
        bySession.set(sessionId, set);
      }
      set.delete(id);
      set.add(id);
      if (set.size > MAX_IDS_PER_SESSION) {
        const oldest = set.values().next().value;
        if (oldest !== undefined) set.delete(oldest);
      }
    },
    isInFlight: (sessionId, toolCallId) => bySession.get(sessionId)?.has(toolCallId) ?? false,
    clear: (sessionId) => {
      bySession.delete(sessionId);
    },
    sessionCount: () => bySession.size,
    idCount: (sessionId) => bySession.get(sessionId)?.size ?? 0,
  };
}
