/**
 * Path-gate → supervised-gate hand-off (design D14).
 *
 * When the operator answers an ENRICHED path prompt (one that already showed the
 * supervised action content) with **Allow once**, the path gate records the call's
 * `toolCallId` here; the supervised gate consumes it and allows without a second
 * prompt. Per-session, bounded (FIFO eviction — an evicted id just means the
 * supervised gate asks), keyed by the session id captured at call start, ids held
 * as plain strings (nested `<parent>/<n>` ids included).
 * See change: add-supervised-tool-approval.
 */

/** Longest per-session id list. */
const HANDOFF_CAP = 64;

export interface HandoffSet {
  record(sessionId: string, toolCallId: string): void;
  /** Remove the id; true exactly once per recorded id. */
  consume(sessionId: string, toolCallId: string): boolean;
  /** `session_shutdown`: drop the session's ids. */
  clear(sessionId: string): void;
  has(sessionId: string): boolean;
}

export function createHandoffSet(cap: number = HANDOFF_CAP): HandoffSet {
  const sets = new Map<string, Set<string>>();
  return {
    record(sessionId, toolCallId) {
      let ids = sets.get(sessionId);
      if (!ids) sets.set(sessionId, (ids = new Set()));
      ids.delete(toolCallId); // re-recording refreshes its FIFO position
      ids.add(toolCallId);
      while (ids.size > cap) ids.delete(ids.values().next().value as string);
    },
    consume(sessionId, toolCallId) {
      const ids = sets.get(sessionId);
      if (!ids?.delete(toolCallId)) return false;
      if (ids.size === 0) sets.delete(sessionId);
      return true;
    },
    clear: (sessionId) => void sets.delete(sessionId),
    has: (sessionId) => sets.has(sessionId),
  };
}
