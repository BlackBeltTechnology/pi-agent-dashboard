/**
 * In-memory tracker for user-initiated session-resume intents.
 *
 * Purpose: distinguish ended→alive transitions caused by a deliberate user
 * action (Resume click, drag-to-resume, REST resume, prompt-auto-resume)
 * from those caused by a bridge auto-reattach on dashboard reboot, AND
 * differentiate between "surface this card at the top" (front) and
 * "respect the slot the user just chose" (keep) for user-driven resumes.
 *
 * The `sessionManager.onChange` hook in `server.ts` consults this registry
 * in its ended→alive branch:
 *
 *   - if `consume(sessionId) === "front"`  → moveToFront + broadcast
 *   - if `consume(sessionId) === "keep"`   → no-op (drop position already
 *                                             persisted via reorder_sessions)
 *   - if `consume(sessionId) === null`     → bridge reattach → leave order alone
 *
 * Tagging happens in `handleResumeSession` (WS), the `/api/session/:id/resume`
 * handler (REST), and `handleSendPrompt`'s ended-branch (prompt-auto-resume),
 * immediately before `spawnPiSession`. The intent value is supplied by the
 * caller — drag-to-resume tags `"keep"`; everyone else tags `"front"`.
 *
 * In-memory only. NOT persisted across server restarts. Stale entries (older
 * than `ttlMs`, default 60 s) are silently dropped on read so a failed spawn
 * cannot poison a later legitimate reattach.
 *
 * See changes: preserve-session-order-on-reboot, top-of-tier-on-status-change,
 *              differentiate-resume-intent-by-trigger.
 */

export const PENDING_RESUME_INTENT_TTL_MS = 60_000;

/** The two user-driven placement intents. */
export type ResumeIntent = "front" | "keep";

interface IntentEntry {
  intent: ResumeIntent;
  timestamp: number;
}

export interface PendingResumeIntentRegistry {
  /**
   * Tag a session id with a placement intent. Idempotent — re-recording the
   * same id refreshes both timestamp and intent (last-write-wins).
   */
  record(sessionId: string, intent: ResumeIntent): void;
  /**
   * Returns the recorded intent and clears the entry iff the session was
   * tagged within the TTL window. Stale entries are dropped silently and
   * `null` is returned. `null` is also returned for never-tagged ids.
   */
  consume(sessionId: string): ResumeIntent | null;
  /** Test helper — number of live (non-expired) entries. */
  size(): number;
}

export interface PendingResumeIntentRegistryOptions {
  /** Override the TTL in milliseconds. Defaults to 60_000. */
  ttlMs?: number;
  /** Override `Date.now` for tests. */
  now?: () => number;
}

export function createPendingResumeIntentRegistry(
  opts: PendingResumeIntentRegistryOptions = {},
): PendingResumeIntentRegistry {
  const ttl = opts.ttlMs ?? PENDING_RESUME_INTENT_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  // sessionId -> { intent, timestamp } of most recent record() call.
  const store = new Map<string, IntentEntry>();

  function pruneStale(): void {
    const cutoff = now() - ttl;
    for (const [id, entry] of store) {
      if (entry.timestamp < cutoff) store.delete(id);
    }
  }

  return {
    record(sessionId: string, intent: ResumeIntent): void {
      if (!sessionId) return;
      // Last-write-wins on re-record: a second user action for the same
      // session (e.g. drag-then-button-click) should reflect the most
      // recent intent. Also refreshes the timestamp so a slow bridge
      // round-trip doesn't expire mid-resume.
      store.set(sessionId, { intent, timestamp: now() });
    },

    consume(sessionId: string): ResumeIntent | null {
      if (!sessionId) return null;
      const entry = store.get(sessionId);
      if (entry === undefined) return null;
      if (entry.timestamp < now() - ttl) {
        store.delete(sessionId);
        return null;
      }
      store.delete(sessionId);
      return entry.intent;
    },

    size(): number {
      pruneStale();
      return store.size;
    },
  };
}
