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
 * PROVENANCE: `browser-gateway` broadcasts live events to every browser socket,
 * so a tab accumulates buffers for sessions it never opened. A cursor derived
 * from such a buffer is self-consistent but represents no history at all. Only a
 * buffer DESCENDED from a replay this tab received is persistable; a
 * non-descended flush is skipped SILENTLY and never deletes (the store is shared
 * across tabs, buffers are per-tab).
 *
 * See change: reduce-session-replay-traffic, fix-replay-cache-partial-payload-cursor.
 */
import { type CachedEvent, type ReplayCache, replayCache } from "./replay-cache.js";

/** Where a batch came from. `replay` answers this tab's own subscribe and is
 *  therefore authoritative; `live` is an unsolicited broadcast fan-out. */
export type RecordOrigin = "live" | "replay";

export interface ReplayPersister {
  /** Append events (dedup by seq) and schedule a debounced persist. */
  record(sessionId: string, events: CachedEvent[], origin: RecordOrigin): void;
  /** Replace the buffer wholesale (rehydrate seeding / replay reset). */
  seed(sessionId: string, events: CachedEvent[]): void;
  /** Clear buffer + delete the persisted entry (invalidation). Awaitable so a
   *  fast reload/close after session_state_reset can't race a surviving entry. */
  drop(sessionId: string): Promise<void>;
  /** Force an immediate flush (tests / unmount). */
  flush(sessionId: string): Promise<void>;
  /** Discard ALL in-memory buffers, timers and provenance (server switch).
   *  Purely in-memory and cannot fail — NOT an invalidation: the durable store
   *  is untouched, because entries are server-scoped and the previous server's
   *  entries stay valid for a switch back. */
  resetBuffers(): void;
}

export function createReplayPersister(
  cache: ReplayCache = replayCache,
  debounceMs = 1000,
  /** Current server identity, read at FLUSH time (not construction time) so a
   *  buffer flushed after a switch is attributed to the server now connected. */
  getServerKey: () => string = () => "",
): ReplayPersister {
  const buffers = new Map<string, CachedEvent[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Sessions whose buffer descends from a replay this tab received. */
  const descended = new Set<string>();
  /** Sessions whose buffer holds unauthorized live content (a stray broadcast
   *  row, or a hole left by a dropped live frame). A replay batch CANNOT clear
   *  this: `record()` dedups by seq, so replayed rows at or below the buffered
   *  max are discarded and the contaminated buffer would survive unchanged
   *  while gaining provenance. Only `seed()`, which replaces the buffer
   *  wholesale, can restore it. */
  const contaminated = new Set<string>();

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
    // No provenance → skip silently. Never delete: a sibling tab may hold a
    // valid entry for this session (design D2/D3).
    if (!descended.has(sessionId)) return;
    await cache.put(sessionId, { maxSeq: maxSeqOf(buf), payload: buf }, getServerKey());
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

  function record(sessionId: string, events: CachedEvent[], origin: RecordOrigin): void {
    if (events.length === 0) return;
    const buf = buffers.get(sessionId) ?? [];
    let max = maxSeqOf(buf);
    for (const e of events) {
      if (e.seq > max) {
        // Live frames are contiguous by construction, so a jump means a frame
        // was dropped (gateway back-pressure) and the cursor would skip it
        // permanently. Replay-path gaps are legitimate (compaction) — exempt.
        if (origin === "live" && max > 0 && e.seq > max + 1) {
          descended.delete(sessionId);
          contaminated.add(sessionId);
        }
        buf.push(e);
        max = e.seq;
      }
    }
    // Live rows appended to a buffer with no provenance are unauthorized
    // content: it can never be promoted, only replaced by seed().
    if (origin === "live" && !descended.has(sessionId)) contaminated.add(sessionId);
    // A replay envelope only ever answers this tab's own subscribe — but it can
    // only vouch for a buffer it actually constituted.
    if (origin === "replay" && !contaminated.has(sessionId)) descended.add(sessionId);
    buffers.set(sessionId, buf);
    schedule(sessionId);
  }

  function seed(sessionId: string, events: CachedEvent[]): void {
    // Wholesale replacement: no unauthorized row survives, so provenance is
    // restorable even after contamination.
    buffers.set(sessionId, [...events]);
    contaminated.delete(sessionId);
    descended.add(sessionId);
    schedule(sessionId);
  }

  async function drop(sessionId: string): Promise<void> {
    const t = timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      timers.delete(sessionId);
    }
    buffers.delete(sessionId);
    descended.delete(sessionId);
    contaminated.delete(sessionId);
    await cache.delete(sessionId);
  }

  function resetBuffers(): void {
    // Clear timers so no pending debounce fires against the new server's key
    // (flush reads getServerKey() at fire time). The ordering is NOT itself
    // load-bearing — both clears run in one synchronous tick, so no timer can
    // fire between them; what neutralizes an already-queued callback is the
    // buffer clear, since flush() early-returns on an empty buffer.
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    buffers.clear();
    descended.clear();
    contaminated.clear();
  }

  return { record, seed, drop, flush, resetBuffers };
}
