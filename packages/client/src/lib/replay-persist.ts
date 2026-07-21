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
  /** Replace the buffer wholesale (rehydrate seeding / replay reset). Sets the
   *  persist boundary to the window's oldest seq so later `prepend`ed older
   *  pages are excluded from persistence. */
  seed(sessionId: string, events: CachedEvent[]): void;
  /**
   * Prepend an older paginated window (dedup by seq) WITHOUT scheduling a
   * persist and WITHOUT moving the persist boundary, so the durable cache stays
   * the tail segment only. Returns the full in-memory buffer (ascending by seq)
   * for the client's full refold. See change: tail-first-session-loading.
   */
  prepend(sessionId: string, events: CachedEvent[]): CachedEvent[];
  /** Read the full in-memory raw buffer (ascending by seq); [] when absent. */
  getBuffer(sessionId: string): CachedEvent[];
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
  // Persist boundary per session: only events with `seq >= persistFrom` are
  // written to the durable cache. `seed` sets it to the tail window's oldest
  // seq; `prepend`ed older pages (seq below the boundary) stay in the in-memory
  // buffer for refold but never persist, so the cache stays bounded regardless
  // of pagination depth. See change: tail-first-session-loading.
  const persistFrom = new Map<string, number>();

  function maxSeqOf(buf: CachedEvent[]): number {
    let m = 0;
    for (const e of buf) if (e.seq > m) m = e.seq;
    return m;
  }

  function minSeqOf(buf: CachedEvent[]): number {
    let m = Number.POSITIVE_INFINITY;
    for (const e of buf) if (e.seq < m) m = e.seq;
    return Number.isFinite(m) ? m : 0;
  }

  async function flush(sessionId: string): Promise<void> {
    const t = timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      timers.delete(sessionId);
    }
    const buf = buffers.get(sessionId);
    if (!buf || buf.length === 0) return;
    // Persist only the tail segment (seq >= boundary); older paginated pages
    // are excluded so the cache stays bounded.
    const boundary = persistFrom.get(sessionId) ?? 0;
    const payload = boundary > 0 ? buf.filter((e) => e.seq >= boundary) : buf;
    if (payload.length === 0) return;
    await cache.put(sessionId, { maxSeq: maxSeqOf(payload), payload });
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
    // The seeded window is the persist-eligible tail; older prepends fall below
    // this boundary and are excluded from the durable cache.
    persistFrom.set(sessionId, minSeqOf(events));
    schedule(sessionId);
  }

  function prepend(sessionId: string, events: CachedEvent[]): CachedEvent[] {
    const buf = buffers.get(sessionId) ?? [];
    const seen = new Set(buf.map((e) => e.seq));
    const older = events.filter((e) => !seen.has(e.seq));
    // Older windows carry seqs strictly below the buffer; prepend in order.
    // Keep the buffer ascending by seq (server sends the window ascending).
    const merged = older.length > 0 ? [...older, ...buf] : buf;
    merged.sort((a, b) => a.seq - b.seq);
    buffers.set(sessionId, merged);
    // NOTE: no schedule() and no persistFrom change — older pages never persist.
    return merged;
  }

  function getBuffer(sessionId: string): CachedEvent[] {
    return buffers.get(sessionId) ?? [];
  }

  async function drop(sessionId: string): Promise<void> {
    const t = timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      timers.delete(sessionId);
    }
    buffers.delete(sessionId);
    persistFrom.delete(sessionId);
    await cache.delete(sessionId);
  }

  return { record, seed, prepend, getBuffer, drop, flush };
}
