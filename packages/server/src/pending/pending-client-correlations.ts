/**
 * Maps `spawnToken` (server-minted UUID) → `requestId` (client-minted UUID).
 *
 * Recorded by `handleSpawnSession` / `handleResumeSession` when the browser
 * supplied a `requestId`. Consumed by `event-wiring.ts` after a successful
 * `linkByToken` so the eventual `session_added` broadcast can carry
 * `spawnRequestId` for client-side auto-select / placeholder dismissal.
 *
 * In-memory only. The TTL is supplied PER RECORD by the caller, derived from
 * the very timeout that armed that spawn's watchdog
 * (`deriveSpawnCorrelationTtlMs`) — a module-level literal cannot see a
 * configured `spawnRegisterTimeoutMs` and used to kill the token before the
 * watchdog it was meant to outlive had even fired.
 *
 * See change: spawn-correlation-token, fix-spawn-correlation-ttl-coupling.
 */

interface Entry {
  requestId: string;
  recordedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingClientCorrelations {
  /**
   * Record `spawnToken → requestId`. Overwrites any prior entry for the same
   * token. `ttlMs` must come from `deriveSpawnCorrelationTtlMs` applied to the
   * timeout used to arm this spawn; a non-positive TTL records nothing.
   */
  record(spawnToken: string, requestId: string, ttlMs: number): void;
  /** Consume the requestId for a spawnToken, or undefined if none / expired. */
  consume(spawnToken: string): string | undefined;
  /** Drop all entries (server shutdown / tests). */
  dispose(): void;
  /** Number of tracked entries (for tests). */
  size(): number;
}

export function createPendingClientCorrelations(): PendingClientCorrelations {
  const store = new Map<string, Entry>();

  return {
    record(spawnToken: string, requestId: string, ttlMs: number): void {
      if (!spawnToken || !requestId) return;
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
      const prior = store.get(spawnToken);
      if (prior) clearTimeout(prior.timer);
      const timer = setTimeout(() => {
        store.delete(spawnToken);
      }, ttlMs);
      store.set(spawnToken, { requestId, recordedAt: Date.now(), timer });
    },

    consume(spawnToken: string): string | undefined {
      if (!spawnToken) return undefined;
      const entry = store.get(spawnToken);
      if (!entry) return undefined;
      clearTimeout(entry.timer);
      store.delete(spawnToken);
      return entry.requestId;
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
