/**
 * Prompts written to a bridge socket and not yet acknowledged by it.
 *
 * `POST /api/session/:id/prompt` reports TRANSMISSION — a byte left the server
 * — and returns a `promptId`. The owning bridge echoes that id on
 * `prompt_received`, which is what makes DELIVERY (pi actually got it)
 * observable, without gating the response on a round trip.
 *
 * Older bridges never echo, and a session can unregister mid-flight, so every
 * entry is bounded twice: by the same derived window the spawn correlations use
 * (`timeout + GRACE + MARGIN`), and by the session unregistering.
 *
 * See change: fix-spawn-correlation-ttl-coupling (D7).
 */

/**
 * Cap on prompts in flight FOR ONE SESSION. The TTL and the unregister sweep
 * bound each entry's LIFETIME, not the COUNT: `POST /api/session/:id/prompt` is
 * unauthenticated on a trusted network and mints a timer per call, so a tight
 * prompt loop would otherwise grow the map at arrival-rate × TTL. Past the cap
 * the OLDEST in-flight ack for that session is dropped — it only loses its
 * delivery signal, which is exactly what an un-acknowledged prompt has anyway.
 */
const MAX_IN_FLIGHT_PER_SESSION = 64;

interface Entry {
  sessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingPromptAcks {
  /** Track a transmitted prompt awaiting its bridge acknowledgement. */
  record(promptId: string, sessionId: string, ttlMs: number): void;
  /**
   * Consume the entry for `promptId`. Returns false when unknown, already
   * acknowledged, evicted, or claimed for a DIFFERENT session — a stale
   * connection's ack must not mark another bridge's prompt delivered.
   */
  acknowledge(promptId: string, sessionId: string): boolean;
  /** Drop every entry for a session (it unregistered). Returns how many. */
  evictSession(sessionId: string): number;
  /** Whether the prompt is still awaiting acknowledgement. */
  isPending(promptId: string): boolean;
  dispose(): void;
  size(): number;
}

export function createPendingPromptAcks(): PendingPromptAcks {
  const store = new Map<string, Entry>();

  function drop(promptId: string): void {
    const entry = store.get(promptId);
    if (!entry) return;
    clearTimeout(entry.timer);
    store.delete(promptId);
  }

  /**
   * Enforce the per-session cap by dropping that session's OLDEST in-flight
   * ack. Map iteration is insertion order, so the first match is the oldest.
   */
  function evictOldestIfAtCap(sessionId: string): void {
    let inFlight = 0;
    let oldest: string | undefined;
    for (const [id, entry] of store) {
      if (entry.sessionId !== sessionId) continue;
      if (oldest === undefined) oldest = id;
      inFlight++;
    }
    if (inFlight >= MAX_IN_FLIGHT_PER_SESSION && oldest !== undefined) drop(oldest);
  }

  return {
    record(promptId: string, sessionId: string, ttlMs: number): void {
      if (!promptId || !sessionId) return;
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
      drop(promptId);
      evictOldestIfAtCap(sessionId);
      const timer = setTimeout(() => {
        store.delete(promptId);
      }, ttlMs);
      store.set(promptId, { sessionId, timer });
    },

    acknowledge(promptId: string, sessionId: string): boolean {
      if (!promptId) return false;
      const entry = store.get(promptId);
      if (!entry || entry.sessionId !== sessionId) return false;
      drop(promptId);
      return true;
    },

    evictSession(sessionId: string): number {
      let evicted = 0;
      for (const [promptId, entry] of store) {
        if (entry.sessionId !== sessionId) continue;
        drop(promptId);
        evicted++;
      }
      return evicted;
    },

    isPending(promptId: string): boolean {
      return store.has(promptId);
    },

    dispose(): void {
      for (const entry of store.values()) clearTimeout(entry.timer);
      store.clear();
    },

    size(): number {
      return store.size;
    },
  };
}
