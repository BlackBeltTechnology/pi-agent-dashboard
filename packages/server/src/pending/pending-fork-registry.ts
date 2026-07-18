/**
 * Tracks pending fork operations to place forked sessions after their parent.
 *
 * Keyed by `spawnToken` (UUID minted at fork time). When the forked session's
 * bridge sends `session_register.spawnToken`, the server consumes the entry
 * and places the new sessionId after `parentSessionId` in the cwd's order.
 *
 * Replaces the prior cwd-FIFO keying which suffered the multi-fork-in-same-cwd
 * race (second fork's `recordFork` would overwrite the first).
 *
 * Entries expire after 30 seconds if not consumed.
 *
 * See change: spawn-correlation-token.
 */

const EXPIRY_MS = 30_000;

interface PendingFork {
  parentSessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingForkRegistry {
  /** Record that a fork was initiated from `parentSessionId`, keyed by the spawn token. */
  recordFork(spawnToken: string, parentSessionId: string): void;
  /** Consume the parent session id for a spawn token, or undefined if none pending. */
  consumeFork(spawnToken: string): string | undefined;
  /** Clear all pending entries and timers. */
  dispose(): void;
}

export function createPendingForkRegistry(): PendingForkRegistry {
  const pending = new Map<string, PendingFork>();

  return {
    recordFork(spawnToken: string, parentSessionId: string): void {
      if (!spawnToken) return;
      // Clear any prior entry for the same token (idempotent re-record).
      const existing = pending.get(spawnToken);
      if (existing) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        pending.delete(spawnToken);
      }, EXPIRY_MS);
      pending.set(spawnToken, { parentSessionId, timer });
    },

    consumeFork(spawnToken: string): string | undefined {
      if (!spawnToken) return undefined;
      const entry = pending.get(spawnToken);
      if (!entry) return undefined;
      clearTimeout(entry.timer);
      pending.delete(spawnToken);
      return entry.parentSessionId;
    },

    dispose(): void {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
