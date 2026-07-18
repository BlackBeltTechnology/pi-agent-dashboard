/**
 * Maps `spawnToken` (server-minted UUID) → `requestId` (client-minted UUID).
 *
 * Recorded by `handleSpawnSession` / `handleResumeSession` when the browser
 * supplied a `requestId`. Consumed by `event-wiring.ts` after a successful
 * `linkByToken` so the eventual `session_added` broadcast can carry
 * `spawnRequestId` for client-side auto-select / placeholder dismissal.
 *
 * In-memory only. 60s TTL aligned with `spawn-register-watchdog` recovery
 * window so late registers can still surface the correlation.
 *
 * See change: spawn-correlation-token.
 */

const DEFAULT_TTL_MS = 60_000;

interface Entry {
  requestId: string;
  recordedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingClientCorrelations {
  /** Record `spawnToken → requestId` mapping. Overwrites any prior entry for the same token. */
  record(spawnToken: string, requestId: string): void;
  /** Consume the requestId for a spawnToken, or undefined if none / expired. */
  consume(spawnToken: string): string | undefined;
  /** Drop all entries (server shutdown / tests). */
  dispose(): void;
  /** Number of tracked entries (for tests). */
  size(): number;
}

export interface PendingClientCorrelationsOptions {
  ttlMs?: number;
}

export function createPendingClientCorrelations(
  options?: PendingClientCorrelationsOptions,
): PendingClientCorrelations {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const store = new Map<string, Entry>();

  return {
    record(spawnToken: string, requestId: string): void {
      if (!spawnToken || !requestId) return;
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
