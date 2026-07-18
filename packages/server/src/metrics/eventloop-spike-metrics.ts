/**
 * In-memory ring buffer of recent worst-case event-loop-delay spikes.
 *
 * Process-local, no persistence, O(1) record (no fs, no serialization of large
 * payloads). Reuses the *container* shape of `hydration-metrics.ts` (capped,
 * newest-first, mutation-safe snapshot) but NOT its event-driven per-call model:
 * this buffer is fed by two independent producers —
 *
 *  1. a dedicated `monitorEventLoopDelay` sampler (`eventloop-sampler.ts`),
 *     which records `{ turn: null }` for stalls no instrumented turn owns, and
 *  2. per-turn self-records from the OpenSpec poll path (`directory-service.ts`),
 *     which record `{ turn: "tickOpen" | "dirPollPre" | "dirPollPost" }`.
 *
 * `/api/health` reads `snapshot()`. A failure in the measurement path must never
 * propagate to request handling — callers wrap `record` in try/catch.
 *
 * See change: attribute-openspec-poll-eventloop-stalls.
 */

/** Named event-loop turn a spike is attributed to; `null` when unattributed. */
export type EventLoopTurn = "tickOpen" | "dirPollPre" | "dirPollPost" | null;

export interface EventLoopSpike {
  /** Epoch ms when the spike was recorded. */
  at: number;
  /** Event-loop delay (sampler) or single-turn synchronous run (self-record), ms. */
  ms: number;
  /** Attributed poll turn, or `null` for the dedicated-sampler safety-net feed. */
  turn: EventLoopTurn;
}

export interface EventLoopSpikeMetrics {
  record(spike: EventLoopSpike): void;
  /** Most-recent-first, capped at capacity. Returns a fresh array. */
  snapshot(): EventLoopSpike[];
}

export function createEventLoopSpikeMetrics(capacity: number): EventLoopSpikeMetrics {
  // Guard non-finite/invalid input so the eviction check below always runs;
  // otherwise `buf.length > NaN` is always false and the buffer grows unbounded.
  const cap = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1;
  const buf: EventLoopSpike[] = [];
  return {
    record(spike: EventLoopSpike): void {
      buf.push(spike);
      if (buf.length > cap) buf.shift();
    },
    snapshot(): EventLoopSpike[] {
      // Newest-first copy so callers can't mutate the internal buffer.
      return buf.slice().reverse();
    },
  };
}
