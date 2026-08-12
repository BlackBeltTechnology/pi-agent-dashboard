/**
 * `subscriptions/listen` — a long-lived POST-response stream (SEP: the GET
 * endpoint and `resources/subscribe` are both gone in 2026-07-28).
 *
 * The load-bearing property is LIFETIME. `ctx.onEvent` delivers **every**
 * session's events to every listener, so two things must hold or this becomes
 * both a leak and a data-disclosure bug:
 *
 *   1. **Filtering is per subscription** (S2). A subscriber receives only the
 *      sessions it named. This is a spec requirement, not an optimisation.
 *   2. **The subscription dies with its request** (S4, S5, S6). It is released
 *      on a clean close, on a transport abort, and on server shutdown — all
 *      three funnel through one `close()` so no path can forget.
 *
 * Statelessness is preserved because the subscription is scoped to the single
 * request that opened it. Nothing is shared between requests.
 */
import type { McpCaller } from "./tokens.js";

/** A single event as delivered by `ServerPluginContext.onEvent`. */
export interface SessionEvent {
  sessionId: string;
  payload: unknown;
}

/** The event source — `ctx.onEvent`, narrowed to what this module needs. */
export interface EventSource {
  /** Subscribe to ALL sessions' events; returns an unsubscribe function. */
  onEvent(handler: (sessionId: string, payload: unknown) => void): () => void;
}

/** Where a subscription writes. Backed by the Fastify reply stream. */
export interface StreamSink {
  /** Write one framed event. Returns false when the consumer is behind. */
  write(chunk: string): boolean;
  /** End the response. */
  end(): void;
}

/**
 * Backpressure policy (X12, threshold from Decision 12).
 *
 * A subscriber that stops reading must not be able to grow server memory
 * without bound. When the buffer is full the subscription is DISCONNECTED
 * rather than silently dropping events: a stream with a hole in it is worse
 * than no stream, because the client cannot tell it missed something.
 */
export const MAX_BUFFERED_EVENTS = 1000;

export interface SubscriptionOptions {
  /** Re-check the caller before each delivery — drives S9. */
  isStillAuthorised?: () => boolean;
}

export class McpSubscription {
  private buffered = 0;
  private closed = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sessionIds: ReadonlySet<string>,
    private readonly sink: StreamSink,
    private readonly caller: McpCaller,
    private readonly options: SubscriptionOptions = {},
  ) {}

  /** True once released. Tests assert this rather than poking internals. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Attach to the source. Separated from the constructor so a failure to
   * attach cannot leave a half-live subscription. */
  attach(source: EventSource): this {
    this.unsubscribe = source.onEvent((sessionId, payload) => {
      this.deliver({ sessionId, payload });
    });
    return this;
  }

  private deliver(event: SessionEvent): void {
    if (this.closed) return;

    // S2 — the filter is applied per subscription, before anything is written.
    if (!this.sessionIds.has(event.sessionId)) return;

    // S9 — authorisation is re-checked per delivery, not only at open. A
    // token revoked mid-stream terminates the stream rather than letting it
    // drain silently.
    if (this.options.isStillAuthorised && !this.options.isStillAuthorised()) {
      this.terminate("credential revoked");
      return;
    }

    if (this.buffered >= MAX_BUFFERED_EVENTS) {
      this.terminate("subscriber too slow");
      return;
    }

    this.buffered += 1;
    const ok = this.sink.write(`${JSON.stringify(event)}\n`);
    // A sink that accepted the write has drained it; only a backpressured
    // write keeps counting against the cap.
    if (ok) this.buffered -= 1;
  }

  private terminate(reason: string): void {
    if (this.closed) return;
    try {
      this.sink.write(`${JSON.stringify({ error: "stream terminated", reason })}\n`);
    } catch {
      /* the sink is already gone; closing is all that remains */
    }
    this.close();
  }

  /**
   * Release the subscription. Idempotent, because it is reached from a clean
   * client close, a transport abort, AND shutdown — S4/S5 differ only in which
   * path fires first, so both must converge here.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      this.sink.end();
    } catch {
      /* the transport may already be torn down */
    }
  }

  /** The caller this stream belongs to. */
  get owner(): McpCaller {
    return this.caller;
  }
}

/**
 * Tracks live subscriptions so shutdown can release them all.
 *
 * `size` is the leak canary S4/S5/S6 and P4 assert against: it must return to
 * its baseline after churn, or a listener is outliving its request.
 */
export class SubscriptionRegistry {
  private readonly live = new Set<McpSubscription>();

  get size(): number {
    return this.live.size;
  }

  open(
    source: EventSource,
    sessionIds: readonly string[],
    sink: StreamSink,
    caller: McpCaller,
    options: SubscriptionOptions = {},
  ): McpSubscription {
    const sub = new McpSubscription(new Set(sessionIds), sink, caller, options);
    const originalClose = sub.close.bind(sub);
    // Registry bookkeeping is wired into close() itself rather than left to
    // each call site, so no teardown path can forget to deregister.
    sub.close = () => {
      originalClose();
      this.live.delete(sub);
    };
    sub.attach(source);
    this.live.add(sub);
    return sub;
  }

  /** Release everything — server shutdown, or plugin unload (X8). */
  closeAll(): void {
    for (const sub of [...this.live]) sub.close();
    this.live.clear();
  }
}
