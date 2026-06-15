/**
 * In-memory ring buffer of recent session-hydration timing samples.
 *
 * Process-local, no persistence. Owned by the server process and shared with
 * `directory-service.ts` (records on every `loadSessionEvents`) and the
 * `/api/health` route (reads `snapshot()`). Recording is O(1): no fs, no
 * serialization of large payloads.
 *
 * See change: instrument-session-hydration-timing.
 */

export interface HydrationSample {
  sessionId: string;
  /** Wall-clock duration of the hydration in milliseconds. */
  wallMs: number;
  /** Session JSONL file size in bytes (best-effort; 0 if stat failed). */
  fileBytes: number;
  entryCount: number;
  eventCount: number;
  /** Epoch ms when the sample was recorded. */
  at: number;
}

export interface HydrationMetrics {
  record(sample: HydrationSample): void;
  /** Most-recent-first, capped at capacity. Returns a fresh array. */
  snapshot(): HydrationSample[];
}

export function createHydrationMetrics(capacity: number): HydrationMetrics {
  // Guard non-finite/invalid input so the eviction check below always runs;
  // otherwise `buf.length > NaN` is always false and the buffer grows unbounded.
  const cap = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1;
  const buf: HydrationSample[] = [];
  return {
    record(sample: HydrationSample): void {
      buf.push(sample);
      if (buf.length > cap) buf.shift();
    },
    snapshot(): HydrationSample[] {
      // Newest-first copy so callers can't mutate the internal buffer.
      return buf.slice().reverse();
    },
  };
}
