/**
 * Push fan-out dispatcher.
 *
 * `fanout` is called by `stampUnreadIfTriggered` on EVERY qualifying live
 * trigger for a known session. It returns `void`, never throws, never rejects,
 * and does no synchronous I/O: it reads tokens and the coalesce map from
 * memory, builds the payload, then schedules delivery with `setImmediate`.
 *
 * Cadence (Decision 10): device tokens (`web-push`, `fcm`) only when
 * `unreadEdge`; webhook tokens on every trigger, coalesced to ≤ 1 per
 * `(sessionId, tokenId)` per `coalesceWindowMs` (Decision 1). `test()` bypasses
 * both and returns opaque `{tokenId, ok, gone?}` results.
 *
 * Outcomes (Decision 8): gone → `registry.remove`; ok → `registry.touch`;
 * failure → `registry.recordFailure`. One structured log line per delivery:
 * transport, redacted target, outcome, ms (+ status/errorCode when known).
 * See change: add-server-push-notifications.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { UnreadTriggerSnapshot } from "../session/event-status-extraction.js";
import { buildPushPayload } from "./build-push-payload.js";
import type { PushTokenRegistry } from "./push-token-registry.js";
import {
  isDeviceTransport,
  type PushLogger,
  type PushPayload,
  type PushToken,
  type PushTransport,
  type PushTransportKind,
} from "./push-transports/types.js";
import { displayPushToken } from "./push-token-display.js";

export interface FanoutContext {
  eventType: string;
  after: UnreadTriggerSnapshot;
  payload?: unknown;
  /** True only on the session's unread `false → true` edge. */
  unreadEdge: boolean;
}

export interface PushTestResult {
  tokenId: string;
  ok: boolean;
  gone?: boolean;
}

export interface PushDispatcher {
  fanout(sessionId: string, ctx: FanoutContext): void;
  /** Send a test push to one token (or all). Bypasses cadence + coalescing. */
  test(tokenId?: string): Promise<PushTestResult[]>;
  shutdown(): void;
}

/** Internal transport result: `status`/`errorCode` are logged, never returned by `test()`. */
interface DetailedResult {
  ok: boolean;
  gone?: boolean;
  status?: number;
  errorCode?: string;
}

const TEST_PAYLOAD: PushPayload = {
  type: "session_attention",
  trigger: "test",
  sessionId: "",
  title: "pi-dashboard: test notification",
  body: "Push notifications are working.",
  url: "/",
};

export function createPushDispatcher(opts: {
  registry: PushTokenRegistry;
  transports: Partial<Record<PushTransportKind, PushTransport>>;
  coalesceWindowMs: number;
  getSession: (sessionId: string) => Pick<DashboardSession, "id" | "cwd" | "name" | "model"> | undefined;
  logger: PushLogger;
  now?: () => number;
}): PushDispatcher {
  const { registry, transports, coalesceWindowMs, getSession, logger } = opts;
  const now = opts.now ?? Date.now;
  /** `${sessionId}::${tokenId}` → last webhook send time. */
  const lastSent = new Map<string, number>();
  let stopped = false;

  registry.onRemove((tokenId) => {
    const suffix = `::${tokenId}`;
    for (const key of lastSent.keys()) if (key.endsWith(suffix)) lastSent.delete(key);
  });

  function transportFor(token: PushToken): PushTransport | undefined {
    return transports[token.transport as PushTransportKind];
  }

  function expireCoalesce(at: number): void {
    const horizon = 2 * coalesceWindowMs;
    for (const [key, ts] of lastSent) if (at - ts > horizon) lastSent.delete(key);
  }

  /** Deliver one token; resolves (never rejects) to the detailed result. */
  async function deliver(token: PushToken, payload: PushPayload): Promise<DetailedResult> {
    const transport = transportFor(token);
    const target = displayPushToken(token);
    if (!transport) {
      logger.warn("skipping token with unavailable transport", { tokenId: token.id, transport: token.transport });
      return { ok: false };
    }
    const started = now();
    let result: DetailedResult;
    try {
      result = (await transport.send(token, payload)) as DetailedResult;
    } catch (err) {
      // Never log the raw error: it may carry the target URL in `cause`.
      const errorCode = (err as { code?: unknown })?.code;
      logger.error("push delivery threw", {
        tokenId: token.id,
        transport: token.transport,
        target,
        errorCode: typeof errorCode === "string" ? errorCode : ((err as Error)?.name ?? "Error"),
      });
      result = { ok: false };
    }
    try {
      if (result.gone) registry.remove(token.id);
      else if (result.ok) registry.touch(token.id);
      else registry.recordFailure(token.id);
    } catch (err) {
      logger.error("push outcome bookkeeping failed", { tokenId: token.id, errorCode: (err as Error)?.name ?? "Error" });
    }
    const fields: Record<string, unknown> = {
      tokenId: token.id,
      transport: token.transport,
      target,
      outcome: result.gone ? "gone" : result.ok ? "ok" : "failed",
      ms: now() - started,
    };
    if (result.status !== undefined) fields.status = result.status;
    if (result.errorCode !== undefined) fields.errorCode = result.errorCode;
    (result.ok ? logger.info : logger.warn)("push delivery", fields);
    return result;
  }

  return {
    fanout(sessionId, ctx) {
      try {
        if (stopped) return;
        const session = getSession(sessionId);
        if (!session) return;
        const at = now();
        expireCoalesce(at);
        const due: PushToken[] = [];
        for (const token of registry.matching(sessionId)) {
          if (isDeviceTransport(token.transport)) {
            if (ctx.unreadEdge) due.push(token);
            continue;
          }
          if (token.transport === "webhook") {
            const key = `${sessionId}::${token.id}`;
            const last = lastSent.get(key);
            if (last !== undefined && at - last < coalesceWindowMs) continue;
            lastSent.set(key, at);
          }
          // Webhooks and unknown transports (the latter are skipped with a warning in deliver()).
          due.push(token);
        }
        if (due.length === 0) return;
        const payload = buildPushPayload(session, ctx);
        const snapshot = due.map((t) => ({ ...t }));
        setImmediate(() => {
          Promise.allSettled(snapshot.map((t) => deliver(t, payload))).catch((err) =>
            logger.error("push fan-out failed", { errorCode: (err as Error)?.name ?? "Error" }),
          );
        });
      } catch (err) {
        logger.error("push fan-out failed", { sessionId, errorCode: (err as Error)?.name ?? "Error" });
      }
    },

    async test(tokenId) {
      const tokens = tokenId ? [registry.get(tokenId)].filter((t): t is PushToken => !!t) : registry.list();
      const results = await Promise.all(tokens.map((t) => deliver({ ...t }, TEST_PAYLOAD)));
      return tokens.map((t, i) => {
        const r = results[i];
        return r.gone ? { tokenId: t.id, ok: false, gone: true } : { tokenId: t.id, ok: r.ok };
      });
    },

    shutdown() {
      stopped = true;
      lastSent.clear();
    },
  };
}
