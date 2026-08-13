/**
 * WebSocket connection manager with exponential backoff reconnection
 * and message buffering during disconnection.
 */

export interface ConnectionManagerOptions {
  url: string;
  WebSocketImpl?: any;
  maxBufferSize?: number;
  /**
   * Bound on the SERIALIZED INBOUND queue. Distinct from `maxBufferSize`, which
   * bounds the OUTGOING send ring. On overflow the newest inbound message is
   * refused. Default 1000.
   *
   * NOTE: the drain loop dequeues with `Array.prototype.shift()`, which
   * reindexes the remainder — so draining is O(n²) in the queue length. That is
   * irrelevant at the default bound (1000 → sub-millisecond), but raising this
   * value by orders of magnitude would make the cost noticeable; switch the
   * queue to a read-index/deque first if you ever do.
   * See change: serialize-bridge-message-pump.
   */
  maxInboundQueue?: number;
  /** Server liveness watchdog: force reconnect after this many ms without any received message. Default 60000. Set 0 to disable. */
  watchdogTimeout?: number;
  onMessage?: (data: unknown) => void | Promise<void>;
  onReconnect?: () => void;
}

export class ConnectionManager {
  private url: string;
  private WS: any;
  private ws: any | null = null;
  private buffer: string[] = [];
  private maxBufferSize: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private intentionalClose = false;
  private hasConnectedBefore = false;
  private onMessage?: (data: unknown) => void | Promise<void>;
  private onReconnect?: () => void;

  /**
   * Serialized inbound pump. `ws.onmessage` enqueues; a single drain loop
   * awaits each handler to completion before dispatching the next, so a
   * state-mutating message (`set_model`) can no longer be overtaken by a
   * dependent one (`send_prompt`) that runs during its first `await`.
   * See change: serialize-bridge-message-pump.
   */
  private inboundQueue: unknown[] = [];
  private draining = false;
  /**
   * Bumped on every teardown. The drain loop captures it on entry and retires
   * itself when it no longer matches, so a loop parked on an uncancellable
   * in-flight handler can never dispatch against a replacement connection.
   */
  private drainEpoch = 0;
  private maxInboundQueue: number;
  private droppedInboundCount = 0;
  private discardedInboundCount = 0;
  private lastInboundWarnAt = 0;

  /**
   * Types dispatched WITHOUT waiting for the serialized queue. Allow-list: an
   * unrecognized type falls through to the serialized lane. Each member is
   * incapable of invalidating a message queued behind it —
   * `prompt_response` is correlated by request id (queueing it behind the
   * handler awaiting it would deadlock permanently), `server_restarting` is a
   * time-critical lifecycle signal delivered immediately before the socket
   * closes, and `kill_process` is pgid-keyed and is the only mechanism able to
   * terminate a child that is itself occupying the queue.
   * `abort` is deliberately NOT here: dispatched early it would run ahead of
   * the `send_prompt` it cancels and silently lose the cancellation.
   * `request_models` touches only the dashboard's own model catalogue (an
   * auth reload + a provider refresh) — never pi's turn state — and that
   * refresh is network-bound: serialized, a slow or
   * hung refresh blocks the head of the queue and every later message —
   * including `send_prompt` — never dispatches.
   * See change: fix-optimistic-prompt-stuck-sending.
   */
  private static readonly IMMEDIATE_TYPES = new Set(["prompt_response", "server_restarting", "kill_process", "request_models"]);

  private static readonly INITIAL_BACKOFF = 1000;
  private static readonly MAX_BACKOFF = 30000;
  private static readonly WATCHDOG_CHECK_INTERVAL = 15_000;
  private static readonly DEFAULT_WATCHDOG_TIMEOUT = 60_000;

  private lastMessageAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimeout: number;

  /**
   * Auto-start suppression deadline (epoch ms). When the server announces
   * a deliberate restart/shutdown via `server_restarting`, the bridge sets
   * this to `Date.now() + quiesceMs` so the spawn step in `autoStartServer`
   * is skipped while the orchestrator does its work. Discovery + reconnect
   * are NOT suppressed.
   * See change: fix-restart-bridge-auto-start-race.
   */
  private suppressUntil = 0;

  constructor(options: ConnectionManagerOptions) {
    this.url = options.url;
    this.WS = options.WebSocketImpl ?? (globalThis as any).WebSocket;
    // Validate the numeric options up front: a negative bound would refuse
    // every message and a NaN/Infinity bound would disable the limit entirely
    // (`length >= NaN` is always false), both silently.
    this.maxBufferSize = ConnectionManager.intOption(options.maxBufferSize, 10000, "maxBufferSize", 1);
    this.maxInboundQueue = ConnectionManager.intOption(options.maxInboundQueue, 1000, "maxInboundQueue", 1);
    // `watchdogTimeout` accepts 0 — that documented value disables the watchdog.
    this.watchdogTimeout = ConnectionManager.intOption(
      options.watchdogTimeout,
      ConnectionManager.DEFAULT_WATCHDOG_TIMEOUT,
      "watchdogTimeout",
      0,
    );
    this.onMessage = options.onMessage;
    this.onReconnect = options.onReconnect;
  }

  /**
   * Resolve a numeric constructor option, rejecting values that would silently
   * break the behaviour they configure. `min` is the smallest legal value (1 for
   * the bounds, 0 for `watchdogTimeout` where 0 means "disabled").
   */
  private static intOption(value: number | undefined, fallback: number, name: string, min: number): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < min) {
      throw new RangeError(`${name} must be a safe integer >= ${min} (received ${resolved})`);
    }
    return resolved;
  }

  connect(): void {
    this.intentionalClose = false;
    this.createConnection();
    this.startWatchdog();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.resetInbound();
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: unknown): void {
    const data = JSON.stringify(message);

    if (this.ws?.readyState === 1) {
      try {
        this.ws.send(data);
      } catch {
        // Connection died between readyState check and send — buffer instead
        this.bufferMessage(data);
      }
    } else {
      this.bufferMessage(data);
    }
  }

  /**
   * Count of outgoing messages evicted from the bounded send buffer while the
   * WS was not OPEN (ring-buffer overflow). Silent before this change — an
   * evicted event never reaches the server store, leaves no seq gap, and is
   * only recovered by `replaySessionEntries()` on reconnect. Exposed for
   * observability. See change: fix-stuck-tool-card-on-dropped-event.
   */
  private droppedBufferedCount = 0;
  private static readonly DROP_WARN_WINDOW_MS = 5_000;
  private lastDropWarnAt = 0;

  /** Total messages evicted from the send buffer on overflow (for diagnostics). */
  getDroppedBufferedCount(): number {
    return this.droppedBufferedCount;
  }

  /**
   * Inbound messages REFUSED because the serialized queue was at
   * `maxInboundQueue`. Kept separate from `getDiscardedInboundCount()` because
   * an overflow is a bug signal while a disconnect discard is routine — one
   * counter would let reconnect churn mask the overflow.
   */
  getDroppedInboundCount(): number {
    return this.droppedInboundCount;
  }

  /** Inbound messages discarded because the socket went away before dispatch. */
  getDiscardedInboundCount(): number {
    return this.discardedInboundCount;
  }

  /**
   * Route an inbound message: immediate lane, or the serialized queue with
   * drop-newest back-pressure.
   */
  private enqueueInbound(parsed: unknown): void {
    const type = (parsed as { type?: unknown } | null)?.type;
    if (typeof type === "string" && ConnectionManager.IMMEDIATE_TYPES.has(type)) {
      this.dispatchInbound(parsed);
      return;
    }

    if (this.inboundQueue.length >= this.maxInboundQueue) {
      // Drop NEWEST: refusing the tail keeps the ordering guarantee of the
      // already-accepted prefix intact. (Dropping oldest would silently discard
      // the `set_model` whose ordering this pump exists to protect.)
      this.droppedInboundCount++;
      const now = Date.now();
      if (now - this.lastInboundWarnAt >= ConnectionManager.DROP_WARN_WINDOW_MS) {
        this.lastInboundWarnAt = now;
        console.warn(
          `[bridge] refused inbound message (queue full) hop=server→bridge refusedType=${typeof type === "string" ? type : "unknown"} (total refused=${this.droppedInboundCount}, maxInboundQueue=${this.maxInboundQueue})`,
        );
      }
      return;
    }

    this.inboundQueue.push(parsed);
    if (!this.draining) void this.drainInbound();
  }

  /** Invoke the handler without awaiting it, isolating sync throws + rejections. */
  private dispatchInbound(parsed: unknown): void {
    try {
      const result = this.onMessage?.(parsed);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err: unknown) => {
          console.error("[bridge] inbound handler failed:", err);
        });
      }
    } catch (err) {
      console.error("[bridge] inbound handler failed:", err);
    }
  }

  private async drainInbound(): Promise<void> {
    this.draining = true;
    const epoch = this.drainEpoch;
    while (this.inboundQueue.length > 0) {
      const msg = this.inboundQueue.shift();
      try {
        await this.onMessage?.(msg);
      } catch (err) {
        // Failure isolation lives here: the pump owns the loop that could stall.
        console.error("[bridge] inbound handler failed:", err);
      }
      // Superseded by a teardown while awaiting: retire WITHOUT touching the
      // queue or the guard — a replacement loop already owns both.
      if (epoch !== this.drainEpoch) return;
    }
    this.draining = false;
  }

  /**
   * Drop the pending inbound queue and retire the current drain loop. The
   * running-guard is released HERE, not when the superseded loop finally
   * exits: an in-flight handler cannot be cancelled, so waiting for it would
   * stall the replacement connection for the handler's full duration.
   */
  private resetInbound(): void {
    if (this.inboundQueue.length > 0) {
      this.discardedInboundCount += this.inboundQueue.length;
      this.inboundQueue = [];
    }
    this.drainEpoch++;
    this.draining = false;
  }

  private bufferMessage(data: string): void {
    this.buffer.push(data);
    if (this.buffer.length > this.maxBufferSize) {
      const evicted = this.buffer.shift();
      this.droppedBufferedCount++;
      let droppedType = "unknown";
      try {
        const parsed = JSON.parse(evicted ?? "");
        if (parsed && typeof parsed.type === "string") droppedType = parsed.type;
      } catch {
        // best-effort: leave "unknown"
      }
      const now = Date.now();
      if (now - this.lastDropWarnAt >= ConnectionManager.DROP_WARN_WINDOW_MS) {
        this.lastDropWarnAt = now;
        console.warn(
          `[bridge] dropped buffered message (ring overflow) hop=bridge→server droppedType=${droppedType} (total dropped=${this.droppedBufferedCount}, bufferSize=${this.maxBufferSize})`,
        );
      }
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === 1;
  }

  /**
   * Pause auto-start spawn for `ms` milliseconds. Idempotent: only extends
   * the suppression window, never shortens it. See change:
   * fix-restart-bridge-auto-start-race.
   */
  pauseAutoStart(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const next = Date.now() + ms;
    if (next > this.suppressUntil) this.suppressUntil = next;
  }

  /**
   * Returns true while the auto-start spawn step should be suppressed.
   * See change: fix-restart-bridge-auto-start-race.
   */
  shouldSuppressAutoStart(): boolean {
    return Date.now() < this.suppressUntil;
  }

  /**
   * Update the WebSocket URL and reconnect.
   * Used when mDNS discovers the server on a different address/port.
   */
  updateUrl(newUrl: string): void {
    if (newUrl === this.url) return;
    this.url = newUrl;
    // Force reconnect to new URL
    if (this.ws) {
      this.handleDisconnect();
    }
  }

  private createConnection(): void {
    try {
      this.ws = new this.WS(this.url);
    } catch {
      // Constructor failed — schedule reconnect
      this.ws = null;
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
      return;
    }

    this.ws.onopen = () => {
      // Reset backoff on successful connection
      this.backoff = 0;
      this.lastMessageAt = Date.now();

      // Notify reconnect if this isn't the first connection
      if (this.hasConnectedBefore) {
        this.onReconnect?.();
      }
      this.hasConnectedBefore = true;

      // Flush buffer
      const buffered = [...this.buffer];
      this.buffer = [];
      for (const data of buffered) {
        this.ws?.send(data);
      }
    };

    this.ws.onmessage = (ev: { data: string }) => {
      this.lastMessageAt = Date.now();
      try {
        const parsed = JSON.parse(ev.data);
        // Handler dispatch is SERIALIZED: `enqueueInbound` appends to a queue
        // drained by a single loop that awaits each handler to completion, so a
        // `set_model` can no longer be overtaken by a following `send_prompt`
        // during its first `await`. Three types bypass the queue (see
        // `IMMEDIATE_TYPES`); everything else, including `abort`, is ordered.
        // The client-side confirm-before-send gate in the OpenSpec dialogs is
        // kept as belt-and-suspenders.
        // See change: serialize-bridge-message-pump.
        this.enqueueInbound(parsed);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = () => {
      // Node 22's built-in WebSocket may fire onerror WITHOUT onclose
      // on connection failure. Handle once and prevent re-entrant calls
      // (ws.close() can re-trigger onerror synchronously).
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    if (!this.ws) return; // Already handled — idempotent guard
    this.resetInbound();
    const ws = this.ws;
    this.ws = null;
    // Detach handlers to prevent re-entrant calls from ws.close()
    ws.onclose = null;
    ws.onerror = null;
    ws.onopen = null;
    ws.onmessage = null;
    try { ws.close(); } catch { /* ignore — may already be closed */ }
    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    if (this.watchdogTimeout <= 0) return;
    this.watchdogTimer = setInterval(() => {
      if (this.ws && this.lastMessageAt > 0 && Date.now() - this.lastMessageAt >= this.watchdogTimeout) {
        // Server has gone silent — force close to trigger reconnect
        this.handleDisconnect();
      }
    }, ConnectionManager.WATCHDOG_CHECK_INTERVAL);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.backoff === 0) {
      this.backoff = ConnectionManager.INITIAL_BACKOFF;
    } else {
      this.backoff = Math.min(this.backoff * 2, ConnectionManager.MAX_BACKOFF);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, this.backoff);
  }
}
