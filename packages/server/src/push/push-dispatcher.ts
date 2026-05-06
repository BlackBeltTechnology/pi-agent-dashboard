/**
 * Push dispatcher — fanout engine with coalescing, dead-token pruning,
 * and fire-and-forget semantics for automatic triggers.
 *
 * `fanout()` is void-returning and must never throw. Async work is launched
 * with `.catch(log)` so no unhandled rejections escape.
 *
 * `sendNow()` returns per-token results and bypasses coalescing — used by
 * REST endpoints (`/api/push/test`, `/api/push/send`).
 *
 * See change: add-server-push-notifications.
 */
import type { DashboardSession, DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PushTokenRegistry } from "./push-token-registry.js";
import type { PushTransport } from "./push-transports/types.js";
import type { PushPayload } from "./push-types.js";
import { buildPushPayload } from "./build-push-payload.js";

export interface PushDispatcherOptions {
  transports: Map<string, PushTransport>;
  registry: PushTokenRegistry;
  coalesceWindowMs: number;
}

export interface SendResult {
  tokenId: string;
  ok: boolean;
  gone?: boolean;
}

export interface PushDispatcher {
  /**
   * Fan-out a push for an automatic trigger event.
   * Void-returning, never throws. Coalescing is applied per-(session, token).
   */
  fanout(sessionId: string, sessionAfter: DashboardSession | undefined, event: DashboardEvent): void;

  /**
   * Send a push immediately, bypassing coalescing.
   * Used by REST endpoints that need per-token results.
   * When `opts.tokenIds` is provided, only those tokens receive the push.
   */
  sendNow(payload: PushPayload, opts?: { tokenIds?: string[] }): Promise<SendResult[]>;
}

/**
 * Create a push dispatcher.
 *
 * Coalescing map: `${sessionId}::${tokenId}` → timestamp of last send.
 * Lazily expired on `fanout` calls (O(entries) sweep). The per-send
 * timeout of 10s is enforced at the dispatcher level via `Promise.race`.
 */
export function createPushDispatcher(opts: PushDispatcherOptions): PushDispatcher {
  const { transports, registry, coalesceWindowMs } = opts;

  // Coalescing map: `${sessionId}::${tokenId}` → last dispatch timestamp
  const coalesceMap = new Map<string, number>();

  function coalesceKey(sessionId: string, tokenId: string): string {
    return `${sessionId}::${tokenId}`;
  }

  /** Lazily expire stale coalescing entries. */
  function expireCoalesceMap(now: number): void {
    for (const [key, ts] of coalesceMap) {
      if (now - ts > coalesceWindowMs) {
        coalesceMap.delete(key);
      }
    }
  }

  /**
   * Send to a single token. Returns result (never throws).
   * The caller handles dead-token pruning and touch.
   */
  async function sendToOne(
    token: import("./push-types.js").PushToken,
    payload: PushPayload,
    transport: PushTransport,
  ): Promise<SendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const result = await transport.send(token, payload, {
        signal: controller.signal,
      });
      return { tokenId: token.id, ok: result.ok, gone: result.gone };
    } catch {
      return { tokenId: token.id, ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fanout(sessionId: string, sessionAfter: DashboardSession | undefined, event: DashboardEvent): void {
      try {
        if (!sessionAfter) return;

        const payload = buildPushPayload(sessionAfter, event);
        const tokens = registry.list();
        if (tokens.length === 0) return;

        const now = Date.now();
        expireCoalesceMap(now);

        for (const token of tokens) {
          const key = coalesceKey(sessionId, token.id);
          const lastSend = coalesceMap.get(key);

          if (lastSend !== undefined && now - lastSend <= coalesceWindowMs) {
            // Still within coalescing window — skip
            continue;
          }

          coalesceMap.set(key, now);

          const transport = transports.get(token.transport);
          if (!transport) {
            console.warn(`[push-dispatcher] Unknown transport "${token.transport}" for token ${token.id} — skipped`);
            continue;
          }

          // Launch async work; don't await — fire and forget
          sendToOne(token, payload, transport)
            .then((result) => {
              if (result.gone) {
                registry.remove(token.id);
              } else if (result.ok) {
                registry.touch(token.id);
              }
            })
            .catch((err) => {
              console.error(`[push-dispatcher] Unexpected error in sendToOne handler:`, err);
            });
        }
      } catch (err) {
        // fanout must never throw — sync errors from registry/payload are caught
        console.error("[push-dispatcher] fanout caught synchronous error:", err);
      }
    },

    async sendNow(payload: PushPayload, opts?: { tokenIds?: string[] }): Promise<SendResult[]> {
      const tokens = registry.list();
      const filtered = opts?.tokenIds
        ? tokens.filter((t) => opts.tokenIds!.includes(t.id))
        : tokens;

      if (filtered.length === 0) return [];

      const batches = await Promise.all(
        filtered.map(async (token): Promise<SendResult[]> => {
          const transport = transports.get(token.transport);
          if (!transport) {
            console.warn(`[push-dispatcher] Unknown transport "${token.transport}" for token ${token.id} — skipped`);
            return [{ tokenId: token.id, ok: false }];
          }

          const result = await sendToOne(token, payload, transport);
          if (result.gone) registry.remove(token.id);
          else if (result.ok) registry.touch(token.id);
          return [result];
        }),
      );

      return batches.flat();
    },
  };
}
