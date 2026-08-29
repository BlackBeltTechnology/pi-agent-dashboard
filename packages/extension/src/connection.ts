/**
 * WebSocket connection manager with exponential backoff reconnection
 * and message buffering during disconnection.
 */

import { WebSocket as WsWebSocket } from "ws";

import { isLoopbackEndpoint as defaultLoopbackClassifier } from "./endpoint-resolution.js";

/** One migration decision, accepted or refused. The bridge's ONLY record
 * channel for re-targeting — wired to `transportDiagnostics` in bridge.ts so
 * the record reaches the server even under the default
 * `keeperLog.capturePiOutput:false` (fix-bridge-mdns-migration-hijack D5).
 * Every accepted re-target and every refusal produces exactly one record. */
export interface ConnectionMigrationRecord {
  from: string;
  to: string;
  accepted: boolean;
  trigger: string;
  reason: string;
}

export interface ConnectionManagerOptions {
  url: string;
  WebSocketImpl?: any;
  /**
   * Runs before EVERY connection attempt, including reconnects, and may
   * override the URL for that attempt. Exists because a remote bridge's
   * gateway ticket is single-use with a 15s TTL: minting it once at startup
   * would authorise the first connection and no other, so a reconnect after
   * any drop would be refused. Returning nothing leaves the URL as-is.
   */
  prepareConnect?: () => Promise<{ url?: string } | undefined>;
  /**
   * Extra WebSocket upgrade headers, e.g. the Windows `X-Pi-Local-Token`
   * local credential (D6). Requires the `ws` client — the global WebSocket
   * cannot set headers at all.
   */
  headers?: Record<string, string>;
  /**
   * Per-endpoint dial credentials. A re-target MUST NOT carry the previous
   * endpoint's credentials: a loopback local token presented to a discovered
   * remote host is a credential leak, and a ticket minted against the old
   * host is worthless to the new one. When supplied, adoption and reversal
   * both re-derive `{headers, prepareConnect}` for the endpoint actually
   * being dialled. (CodeRabbit review, fix-bridge-mdns-migration-hijack.)
   */
  credentialsFor?: (url: string) => {
    headers?: Record<string, string>;
    prepare?: () => Promise<{ url?: string } | undefined>;
  };
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
  /**
   * Fired on EVERY open, including the first — unlike `onReconnect`, which
   * deliberately skips it. A move's target connection needs the first one:
   * that is when it must announce its provisional registration, and `send()`
   * before the socket is live is silently dropped (task 9.4).
   */
  onOpen?: () => void;
  onReconnect?: () => void;
  /**
   * Fired when the server terminally refuses this bridge's registration for a
   * session id (another live bridge already serves it). Reconnection is NOT
   * retried afterwards. See change: fix-duplicate-bridge-registration (D2).
   */
  onRegisterRejected?: (sessionId: string, reason: string) => void;
  /**
   * The bridge's own session id, used as the ROUTING field of a drop report.
   * The id a dropped message named travels as payload instead, because the
   * gateway refuses any inbound frame whose routing id belongs to another
   * connection. Reporting is skipped until this resolves.
   * See change: fix-spawn-correlation-ttl-coupling (D6).
   */
  getSessionId?: () => string | undefined;
  /**
   * Records EVERY migration decision this manager makes — accepted or
   * refused, with both endpoints, the trigger and the reason. The single
   * chokepoint that makes a re-target un-silent (D5): without it a migration
   * is visible only as an unexplained `connection closed` in server.log.
   * See change: fix-bridge-mdns-migration-hijack.
   */
  onMigrationEvent?: (record: ConnectionMigrationRecord) => void;
  /**
   * Failed connection attempts against a newly adopted endpoint after which
   * the manager returns to the last registered endpoint (reversibility, D2).
   * Default 4 — see MIGRATION_MAX_FAILED_OPENS.
   */
  migrationAttemptsBound?: number;
  /** How long a rejected endpoint may not be re-adopted (anti-ping-pong, D2). Default 60s. */
  migrationCooldownMs?: number;
  /**
   * Loopback classifier for the localhost-preference invariant (D3).
   * Defaults to the pure lexical classifier in endpoint-resolution.ts.
   */
  isLoopbackEndpoint?: (url: string) => boolean;
}

/** Reports per session per window, so an overflow burst cannot amplify. */
const DROP_REPORT_LIMIT = 10;
const DROP_REPORT_WINDOW_MS = 60_000;

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
  private onOpen?: () => void;
  private onReconnect?: () => void;
  private onRegisterRejected?: (sessionId: string, reason: string) => void;
  private getSessionIdForReports?: () => string | undefined;
  private dropReportWindowStart = 0;
  private dropReportsInWindow = 0;
  private dropReportsSuppressed = 0;
  /**
   * Session the counters above belong to. A `ConnectionManager` outlives a
   * `new`/`fork`/`resume` session change, so without this the previous
   * session's exhausted budget would suppress the NEW session's reports for the
   * rest of the window, and its `suppressed` count would ride a report that
   * names a different session.
   */
  private dropReportSessionId: string | undefined;

  /**
   * Report an inbound message this bridge threw away, best-effort.
   *
   * Gated on a LIVE socket with no buffering fallback: `send()` silently
   * buffers when the socket is down, and a buffered report would surface after
   * reconnect and misdescribe when the drop happened.
   * See change: fix-spawn-correlation-ttl-coupling (D6).
   */
  reportInboundDrop(drop: {
    dropClass: "session_mismatch" | "queue_overflow";
    messageType?: string;
    droppedSessionId?: string;
  }): void {
    if (this.ws?.readyState !== 1) return;
    const sessionId = this.getSessionIdForReports?.();
    if (!sessionId) return;

    const now = Date.now();
    if (sessionId !== this.dropReportSessionId) {
      this.dropReportSessionId = sessionId;
      this.dropReportWindowStart = now;
      this.dropReportsInWindow = 0;
      this.dropReportsSuppressed = 0;
    }
    if (now - this.dropReportWindowStart >= DROP_REPORT_WINDOW_MS) {
      this.dropReportWindowStart = now;
      this.dropReportsInWindow = 0;
    }
    if (this.dropReportsInWindow >= DROP_REPORT_LIMIT) {
      this.dropReportsSuppressed++;
      return;
    }
    this.dropReportsInWindow++;
    const suppressed = this.dropReportsSuppressed;
    this.dropReportsSuppressed = 0;

    // Raw `ws.send`, never `this.send`: a report must never be buffered.
    try {
      this.ws.send(
        JSON.stringify({
          type: "inbound_drop_report",
          sessionId,
          dropClass: drop.dropClass,
          ...(drop.messageType ? { messageType: drop.messageType } : {}),
          ...(drop.droppedSessionId ? { droppedSessionId: drop.droppedSessionId } : {}),
          ...(suppressed ? { suppressed } : {}),
        }),
      );
    } catch {
      // Best-effort by contract: the socket died between the check and the send.
    }
  }

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

  /**
   * Failed connection attempts against a migrated-to endpoint before the
   * manager gives up on it and returns to the last registered endpoint.
   *
   * Basis for 4 (design D2, recorded per task 3.4): the reconnect backoff is
   * 1s → 2s → 4s → 8s, so the fourth failure lands ~15s after adoption. A
   * deliberate server restart answers again within ~5–10s (observed on
   * `POST /api/restart`), so 4 attempts ride out a real restart without ever
   * backing off unbounded against a dead candidate — while still returning
   * the bridge to the working endpoint within seconds of a mistaken
   * migration.
   */
  private static readonly MIGRATION_MAX_FAILED_OPENS = 4;
  /** How long a reversed-away endpoint may not be re-adopted (anti-ping-pong, D2).
   * Long enough to outlive the window in which a flapping pair would
   * otherwise swap on every discovery tick; short enough that a deliberate
   * re-discovery a minute later is unaffected. */
  private static readonly MIGRATION_COOLDOWN_MS = 60_000;

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

  /** Upgrade headers presented on every (re)connect. */
  private headers?: Record<string, string>;
  private prepareConnect?: () => Promise<{ url?: string } | undefined>;

  // ── Migration state (fix-bridge-mdns-migration-hijack) ─────────────────
  /** The endpoint on which a `session_register` was last sent on a LIVE
   * socket. The reversal target (D2) and the marker that the incumbent is
   * protected by the admission gate. */
  private lastRegisteredUrl: string | undefined;
  /** A registration noted while the socket was still connecting; promoted
   * when the open flushes the buffered register onto the live socket. */
  private pendingRegisterNote = false;
  /** The configured endpoint, retained as the reversal anchor for a COLD-START
   * adoption (nothing was ever registered, so `lastRegisteredUrl` is
   * undefined and reversal would otherwise have nowhere to go). */
  private fallbackUrl: string | undefined;
  /** Consecutive failed opens against a migrated-to endpoint (D2 counter). */
  private failedOpensSinceMigration = 0;
  /** Endpoint → epoch-ms until which it may not be re-adopted (D2 cooldown). */
  private cooldownUntil = new Map<string, number>();
  private readonly onMigrationEvent?: (record: ConnectionMigrationRecord) => void;
  private readonly migrationAttemptsBound: number;
  private readonly migrationCooldownMs: number;
  private readonly isLoopbackEndpoint: (url: string) => boolean;
  private readonly credentialsFor?: ConnectionManagerOptions["credentialsFor"];

  constructor(options: ConnectionManagerOptions) {
    this.url = options.url;
    this.fallbackUrl = options.url;
    this.headers = options.headers;
    // The `ws` package, NOT `globalThis.WebSocket`.
    //
    // Two independent requirements force this, and one swap satisfies both:
    //   - `ws+unix://<path>:/` is rejected outright by the global/undici
    //     WebSocket (`DOMException: expected a ws: or wss: url`), so the
    //     local socket transport is unreachable without it (D1);
    //   - the Windows local-token credential rides an `X-Pi-Local-Token`
    //     upgrade header, and the global WebSocket cannot set headers (D6).
    // See change: add-pi-gateway-transport-identity (task 2.6).
    this.WS = options.WebSocketImpl ?? WsWebSocket;
    this.prepareConnect = options.prepareConnect;
    this.credentialsFor = options.credentialsFor;
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
    this.onOpen = options.onOpen;
    this.onReconnect = options.onReconnect;
    this.onRegisterRejected = options.onRegisterRejected;
    this.getSessionIdForReports = options.getSessionId;
    this.onMigrationEvent = options.onMigrationEvent;
    this.migrationAttemptsBound = ConnectionManager.intOption(
      options.migrationAttemptsBound,
      ConnectionManager.MIGRATION_MAX_FAILED_OPENS,
      "migrationAttemptsBound",
      1,
    );
    this.migrationCooldownMs = ConnectionManager.intOption(
      options.migrationCooldownMs,
      ConnectionManager.MIGRATION_COOLDOWN_MS,
      "migrationCooldownMs",
      1,
    );
    this.isLoopbackEndpoint = options.isLoopbackEndpoint ?? defaultLoopbackClassifier;
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
      // The warn above is throttled to one per 5 s AND lands in /dev/null under
      // the default `capturePiOutput:false`; the report is what the server can
      // actually record. See change: fix-spawn-correlation-ttl-coupling (D6).
      this.reportInboundDrop({
        dropClass: "queue_overflow",
        messageType: typeof type === "string" ? type : undefined,
      });
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
   * Record that a `session_register` was just sent over this connection.
   *
   * "Acknowledged" here means: delivered on a LIVE socket (the server's only
   * register response is a terminal `register_rejected`; silence is
   * success). Called by the bridge right after each register send — the
   * initial registration and every `sendStateSync` — so the manager always
   * knows the last endpoint that actually accepted it. That endpoint is the
   * reversal target (D2) and marks the connection as protected by the
   * admission gate.
   *
   * Called while still connecting, the note is promoted on open, when the
   * buffered register flushes onto the live socket.
   */
  noteRegistered(): void {
    if (this.ws?.readyState === 1) {
      this.lastRegisteredUrl = this.url;
      this.pendingRegisterNote = false;
      this.failedOpensSinceMigration = 0;
      return;
    }
    this.pendingRegisterNote = true;
  }

  /**
   * Re-target this connection at a new endpoint — the ONLY way an endpoint
   * changes after construction (task 2.2). Replaces the ambient `updateUrl`.
   *
   * Gates, in order (design D1–D3):
   *   cooldown — a previously rejected endpoint may not be re-adopted yet;
   *   protection — an ESTABLISHED AND REGISTERED connection is never dropped
   *     for an unverified candidate (a connection that is merely dialling or
   *     established-but-unregistered — the cold-start window — migrates
   *     freely, which is exactly how init-time discovery attaches);
   *   localhost preference — a remote candidate never displaces an
   *     established loopback connection;
   *   admission — the candidate must pass the caller's health probe BEFORE
   *     the incumbent is dropped: the drop-then-discover-dead window is the
   *     outage this gate exists to prevent.
   *
   * Resolves true when the connection ends up targeting `newUrl` (including
   * the current-URL no-op), false when a gate refused. EVERY decision —
   * accepted or refused — is reported via `onMigrationEvent` (D5); a
   * re-target cannot happen without a corresponding record.
   */
  async retargetTo(
    newUrl: string,
    opts: { trigger: string; verify?: () => Promise<boolean> },
  ): Promise<boolean> {
    const from = this.url;
    if (newUrl === from) return true;
    const record = (accepted: boolean, reason: string): boolean => {
      this.onMigrationEvent?.({ from, to: newUrl, accepted, trigger: opts.trigger, reason });
      return accepted;
    };
    // A manager that was terminally closed (explicit disconnect, or a
    // `register_rejected` contention refusal) must stay closed: discovery
    // callbacks fire regardless of connection state, and adoption's
    // `createConnection` would otherwise resurrect a dead manager.
    // (CodeRabbit review, fix-bridge-mdns-migration-hijack.)
    if (this.intentionalClose) {
      return record(false, "refused: connection is terminally closed");
    }

    // Cooldown applies regardless of establishment: an endpoint this manager
    // reversed away from must not be re-adopted into a ping-pong, even in
    // the cold-start window.
    const cooledUntil = this.cooldownUntil.get(newUrl);
    if (cooledUntil !== undefined && Date.now() < cooledUntil) {
      const remainingS = Math.ceil((cooledUntil - Date.now()) / 1000);
      return record(false, `refused: candidate is in migration cooldown (${remainingS}s remaining)`);
    }

    if (this.lastRegisteredUrl === undefined) {
      // Nothing established AND registered: no incumbent to protect. The
      // configured endpoint is retained as the reversal anchor — a candidate
      // adopted in the cold-start window that never opens must fall back to
      // it after the failed-open bound instead of retrying forever.
      this.fallbackUrl = from;
      this.adoptEndpoint(newUrl);
      return record(true, "adopted: no established registered connection to protect");
    }

    // Admission gate (D1): verify the candidate BEFORE dropping the
    // incumbent. No probe result is a refusal, not a pass. Probing runs
    // before the preference rule so a refusal names the candidate's actual
    // failure (D5's "failure reason"), per the spec's own scenario order —
    // "reachable" is judged first, "preferred under the localhost-preference
    // rule" second.
    if (!opts.verify) {
      return record(false, "refused: no health check was performed for the candidate");
    }
    let reachable: boolean;
    try {
      reachable = await opts.verify();
    } catch {
      reachable = false;
    }
    if (!reachable) {
      return record(false, "refused: candidate health check did not return ok");
    }

    // Localhost preference as an invariant on the connection (D3) — keyed on
    // the incumbent being ESTABLISHED *right now*. A loopback endpoint that
    // has already dropped protects nothing: refusing a reachable remote
    // candidate for a dead localhost incumbent would be the strand class
    // this change exists to eliminate. (Round-1 review finding #1.)
    if (
      this.isConnected &&
      this.isLoopbackEndpoint(from) &&
      !this.isLoopbackEndpoint(newUrl)
    ) {
      return record(
        false,
        "refused: localhost preference — a remote candidate must not displace the established loopback connection",
      );
    }

    this.adoptEndpoint(newUrl);
    return record(true, "adopted: candidate verified reachable before the incumbent was dropped");
  }

  /**
   * Point the manager at a new endpoint and dial it now. The incumbent —
   * when one exists, even mid-dial — is torn down WITHOUT arming the
   * reconnect loop; the fresh dial is made directly.
   */
  private adoptEndpoint(newUrl: string): void {
    const hadSocket = this.ws !== null;
    this.url = newUrl;
    this.applyCredentials(newUrl);
    this.failedOpensSinceMigration = 0;
    this.backoff = 0;
    // Re-adoption clears the endpoint's own cooldown (round-1 review #4):
    // a deliberate adopt is the opposite of the ping-pong the cooldown blocks.
    this.cooldownUntil.delete(newUrl);
    if (hadSocket) {
      this.intentionalClose = true;
      try {
        this.handleDisconnect();
      } finally {
        this.intentionalClose = false;
      }
    }
    // A pending reconnect timer would race the fresh dial against the OLD
    // endpoint — cancel it and dial the adopted endpoint now. A manager that
    // is actively trying to stay connected — live socket, PENDING RECONNECT
    // TIMER (cold-start first dial already failed into backoff), or a prior
    // success — must dial the adopted endpoint; only a manager that was
    // never asked to connect does not self-start. (Round-2 review: a timer
    // cancelled without redialling stranded a mid-backoff cold start.)
    const hadReconnectTimer = this.reconnectTimer !== null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (hadSocket || hadReconnectTimer || this.hasConnectedBefore) this.createConnection();
  }

  /** Re-derive `{headers, prepareConnect}` for the endpoint about to be
   * dialled. Adoption and reversal both route through here so credentials
   * always match the endpoint on the wire — a loopback token must never
   * reach a remote host, and a remote host needs its own ticket. */
  private applyCredentials(url: string): void {
    const c = this.credentialsFor?.(url);
    if (!c) return;
    this.headers = c.headers;
    this.prepareConnect = c.prepare;
  }

  private createConnection(): void {
    if (!this.prepareConnect) {
      this.openSocket();
      return;
    }
    void this.prepareThenOpen().catch(() => this.onPrepareFailed());
  }

  /** Apply a per-attempt URL override (e.g. a freshly minted ticket). The
   * override applies to THIS DIAL only — the base endpoint (`this.url`) is
   * never mutated by preparation, so `lastRegisteredUrl` and every
   * migration record name the real endpoint, not a ticketed one-off. */
  private async prepareThenOpen(): Promise<void> {
    const override = await this.prepareConnect?.();
    this.openSocket(override?.url);
  }

  /**
   * Preparation failed (no credential, dashboard unreachable). Retry on the
   * normal backoff rather than dialling without it: the server would refuse
   * the upgrade anyway, and the operator would see a connection error instead
   * of a credential one.
   */
  private onPrepareFailed(): void {
    if (!this.intentionalClose) this.scheduleReconnect();
  }

  private openSocket(dialUrl: string = this.url): void {
    try {
      this.ws = this.headers
        ? new this.WS(dialUrl, { headers: this.headers })
        : new this.WS(dialUrl);
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

      // A registration noted while this dial was in flight is now real: the
      // buffered `session_register` flushes onto THIS live socket below, so
      // this is the endpoint the server accepted.
      if (this.pendingRegisterNote) {
        this.pendingRegisterNote = false;
        this.lastRegisteredUrl = this.url;
        this.failedOpensSinceMigration = 0;
      }

      // Notify reconnect if this isn't the first connection
      if (this.hasConnectedBefore) {
        this.onReconnect?.();
      }
      this.hasConnectedBefore = true;
      this.onOpen?.();

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
        // A contention refusal is TERMINAL. The server closes us right after
        // sending it, and every close otherwise looks transient, so without
        // this the refused duplicate reconnects and re-registers forever while
        // its pi keeps writing into the incumbent's transcript.
        // See change: fix-duplicate-bridge-registration (D2).
        if (parsed?.type === "register_rejected") {
          this.handleRegisterRejected(parsed.sessionId, parsed.reason);
          return;
        }
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

  /**
   * Stop retrying for a session id the server refused, and surface the reason
   * rather than dying silently.
   */
  private handleRegisterRejected(sessionId: string | undefined, reason: string | undefined): void {
    console.error(
      `[bridge] registration refused for session ${sessionId ?? "(unknown)"}: ` +
        `${reason ?? "no reason given"} — not retrying`,
    );
    this.onRegisterRejected?.(sessionId ?? "", reason ?? "");
    // Treat as an intentional close so `handleDisconnect` does not rearm the
    // backoff loop when the server closes the socket behind this frame.
    this.intentionalClose = true;
    this.handleDisconnect();
  }

  private scheduleReconnect(): void {
    // Reversibility (D2): failed opens are only counted against a MIGRATED
    // endpoint — one that differs from the reversal anchor: the last
    // registered endpoint, or — for a cold-start adoption where nothing was
    // ever registered — the configured endpoint. Reconnect churn against
    // the anchor itself never reverses anywhere.
    const anchor = this.lastRegisteredUrl ?? this.fallbackUrl;
    if (anchor !== undefined && this.url !== anchor) {
      this.failedOpensSinceMigration++;
      if (this.failedOpensSinceMigration >= this.migrationAttemptsBound) {
        const rejected = this.url;
        this.cooldownUntil.set(rejected, Date.now() + this.migrationCooldownMs);
        const from = this.url;
        this.url = anchor;
        this.applyCredentials(anchor);
        this.failedOpensSinceMigration = 0;
        this.backoff = 0;
        this.onMigrationEvent?.({
          from,
          to: this.url,
          accepted: true,
          trigger: "migration-fallback",
          reason: `returned to the last registered endpoint after ${this.migrationAttemptsBound} failed opens against ${rejected}`,
        });
        // Fall through: normal scheduling dials the restored endpoint.
      }
    }

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
