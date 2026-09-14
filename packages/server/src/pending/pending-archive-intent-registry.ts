/**
 * In-memory one-shot archive intents for idle-alive sessions.
 *
 * Archiving an alive-but-idle session must terminate its pi process first; the
 * archive itself then happens on the resulting `ended` transition. This
 * registry carries the "the user asked to archive this" bit across that gap.
 * It expires after `ttlMs` (60 s) so an end that never lands cannot archive the
 * session later, and it is explicitly cleared on resume / turn start.
 *
 * Modelled on `pending-resume-intent-registry.ts` (same TTL + stale-on-read
 * semantics), but carries no payload — the archive bit is the whole signal.
 * In-memory only; not persisted across server restarts.
 *
 * See change: archive-sessions-lazy-load.
 */
const PENDING_ARCHIVE_INTENT_TTL_MS = 60_000;

export interface PendingArchiveIntentRegistry {
  /** Remember an archive intent for `sessionId` (refreshes the timestamp). */
  record(sessionId: string): void;
  /**
   * Return `true` iff an intent was recorded within the TTL, consuming it.
   * Stale entries are dropped silently.
   */
  consume(sessionId: string): boolean;
  /** Drop an intent without consuming it as an archive trigger. */
  clear(sessionId: string): void;
  /** Test helper — number of live (non-expired) entries. */
  size(): number;
}

export interface PendingArchiveIntentRegistryOptions {
  ttlMs?: number;
  now?: () => number;
}

export function createPendingArchiveIntentRegistry(
  opts: PendingArchiveIntentRegistryOptions = {},
): PendingArchiveIntentRegistry {
  const ttl = opts.ttlMs ?? PENDING_ARCHIVE_INTENT_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const store = new Map<string, number>();

  function pruneStale(): void {
    const cutoff = now() - ttl;
    for (const [id, ts] of store) {
      if (ts < cutoff) store.delete(id);
    }
  }

  return {
    record(sessionId: string): void {
      if (!sessionId) return;
      store.set(sessionId, now());
    },
    consume(sessionId: string): boolean {
      if (!sessionId) return false;
      const ts = store.get(sessionId);
      if (ts === undefined) return false;
      store.delete(sessionId);
      return ts >= now() - ttl;
    },
    clear(sessionId: string): void {
      store.delete(sessionId);
    },
    size(): number {
      pruneStale();
      return store.size;
    },
  };
}
