/**
 * Debounced replay-cache persister (Strategy A write path).
 *
 * Owns the per-session RAW event buffer the client accumulates from `event` and
 * `event_replay` messages, and flushes it to the durable replay cache on a
 * debounce so a reload can delta-subscribe (`lastSeq = maxSeq`). The buffer is
 * monotonic by `seq` (appends skip already-seen seqs); a reset replaces it.
 *
 * Invalidation (Phase 4): `drop(sessionId)` clears the buffer AND deletes the
 * persisted entry so a `session_state_reset` never stitches stale history onto
 * reset sequence numbers.
 *
 * See change: reduce-session-replay-traffic.
 */
import { type CachedEvent, type ReplayCache, replayCache } from "./replay-cache.js";

export interface ReplayPersister {
  /** Append events (dedup by seq) and schedule a debounced persist. */
  record(sessionId: string, events: CachedEvent[]): void;
  /** Replace the buffer wholesale (rehydrate seeding / replay reset). */
  seed(sessionId: string, events: CachedEvent[]): void;
  /** Clear buffer + delete the persisted entry (invalidation). Awaitable so a
   *  fast reload/close after session_state_reset can't race a surviving entry. */
  drop(sessionId: string): Promise<void>;
  /** Force an immediate flush (tests / unmount). */
  flush(sessionId: string): Promise<void>;
}

export function createReplayPersister(
  cache: ReplayCache = replayCache,
  debounceMs = 1000,
): ReplayPersister {
  const buffers = new Map<string, CachedEvent[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function maxSeqOf(buf: CachedEvent[]): number {
    let m = 0;
    for (const e of buf) if (e.seq > m) m = e.seq;
    return m;
  }

  async function flush(sessionId: string): Promise<void> {
    const t = timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      timers.delete(sessionId);
    }
    const buf = buffers.get(sessionId);
    if (!buf || buf.length === 0) return;
    await cache.put(sessionId, { maxSeq: maxSeqOf(buf), payload: buf });
  }

  function schedule(sessionId: string): void {
    const existing = timers.get(sessionId);
    if (existing) clearTimeout(existing);
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId);
        void flush(sessionId);
      }, debounceMs),
    );
  }

  function record(sessionId: string, events: CachedEvent[]): void {
    if (events.length === 0) return;
    const buf = buffers.get(sessionId) ?? [];
    let max = maxSeqOf(buf);
    for (const e of events) {
      if (e.seq > max) {
        buf.push(e);
        max = e.seq;
      }
    }
    buffers.set(sessionId, buf);
    schedule(sessionId);
  }

  function seed(sessionId: string, events: CachedEvent[]): void {
    buffers.set(sessionId, [...events]);
    schedule(sessionId);
  }

  async function drop(sessionId: string): Promise<void> {
    const t = timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      timers.delete(sessionId);
    }
    buffers.delete(sessionId);
    await cache.delete(sessionId);
  }

  return { record, seed, drop, flush };
}
