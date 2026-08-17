/**
 * SubagentTickThrottle — bounds the rate of subagent `Agent` ticks on the
 * `tool_execution_update` carrier.
 *
 * Background: a running subagent feeds the dashboard over TWO carriers fed by
 * one `snapshotDetails()` object in the producer. The `subagents:*` carrier is
 * already coalesced to 250 ms by the producer's own emitter; the
 * `tool_execution_update` carrier has no throttle anywhere on its path, so its
 * rate is the subagent's RAW session-event rate (streaming `message_update`
 * deltas included) against a payload carrying the cumulative timeline.
 *
 * This class is that missing throttle, applied at the bridge (our code, seeing
 * every frame, downstream of every producer version in the wild — no producer
 * release needed). Semantics mirror the producer's proven `createProgressEmitter`
 * shape: leading edge fires immediately, within the window only the LATEST
 * frame is retained (safe because every frame is a FULL snapshot), and a
 * trailing timer emits it at window end.
 *
 * Two properties are load-bearing and easy to lose:
 *
 *  - **Nothing after terminal.** On `tool_execution_end` a HELD frame is
 *    DISCARDED, not flushed. This carrier never carries terminal state, so the
 *    pending frame is a strictly stale intermediate snapshot; flushing it would
 *    race the very overwrite the discard prevents (a stale tick landing after
 *    the end event visibly re-opens a finished tool row).
 *  - **Gates are re-checked at FIRE time, not at hold time.** `sessionReady`,
 *    bridge liveness and the session id can all move while a frame is held, and
 *    the send must go over the LIVE connection rather than a captured
 *    reference. A failed gate drops the frame and counts it — that loss is
 *    acceptable only because this carrier is not the recovery path (the
 *    ephemeral carrier's retained snapshot is), and only because the counter
 *    makes it visible.
 *
 * The key map is bounded independently of the terminal hook by an idle TTL, so
 * a run whose end event never arrived (e.g. dropped at the not-ready gate)
 * cannot leak one dead entry per run into a long session.
 *
 * See change: reduce-bridge-tick-bandwidth (D2/D3/D4/D6).
 */

/** Counters for the throttle's two visible actions and two loss modes. */
export interface SubagentTickThrottleStats {
  /** Ticks that reached the wire (leading edge + trailing sends). */
  tickForwarded: number;
  /** Held ticks superseded by a newer one within the same window (never sent). */
  tickCoalesced: number;
  /** Held ticks discarded because their run ended first. */
  tickDiscardedAtTerminal: number;
  /** Held ticks dropped at fire time by a gate (not ready / superseded / drift). */
  tickDroppedNotReady: number;
}

/** Idle-TTL default: two orders of magnitude above the 500 ms window, so it can
 * never sweep a live run, yet short enough that back-to-back subagent runs over
 * hours hold a handful of keys. */
export const DEFAULT_TICK_IDLE_TTL_MS = 60_000;

interface TickEntry<M> {
  /** Timestamp of the last tick that actually went out for this key. */
  lastSent: number;
  /** Timestamp of the last tick OBSERVED for this key (drives the idle TTL). */
  lastSeen: number;
  /** The single retained (latest-wins) frame waiting for the window to close. */
  pending?: { msg: M; sessionId: string };
  /** Armed trailing timer, if a frame is pending. */
  timer?: ReturnType<typeof setTimeout>;
}

export interface SubagentTickThrottleOptions<M> {
  /** Coalescing window in ms. `<= 0` disables the throttle entirely. */
  windowMs: number;
  /**
   * Emit a held frame. MUST resolve the live connection at call time — never
   * close over a connection captured when the frame was held.
   */
  send: (msg: M) => void;
  /**
   * Fire-time gate: bridge still active AND session ready AND the frame's
   * session id still current. False → the frame is dropped and counted.
   */
  canSend: (sessionId: string) => boolean;
  /** Idle TTL before an un-terminated key is swept. */
  idleTtlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class SubagentTickThrottle<M = unknown> {
  private readonly entries = new Map<string, TickEntry<M>>();
  private sweepTimer?: ReturnType<typeof setTimeout>;

  readonly stats: SubagentTickThrottleStats = {
    tickForwarded: 0,
    tickCoalesced: 0,
    tickDiscardedAtTerminal: 0,
    tickDroppedNotReady: 0,
  };

  private readonly windowMs: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: SubagentTickThrottleOptions<M>) {
    this.windowMs = opts.windowMs;
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_TICK_IDLE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Whether the throttle is doing anything at all (config `0` => rollback path). */
  get enabled(): boolean {
    return this.windowMs > 0;
  }

  /** Distinct keys currently tracked (bounded by the terminal hook + idle TTL). */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Offer a tick for `key` (the run's `toolCallId`).
   *
   * @returns `true` when the CALLER should send `msg` synchronously (leading
   * edge, or the throttle disabled); `false` when the throttle has taken
   * ownership of the frame and will send it (or discard it) later.
   */
  offer(key: string, msg: M, sessionId: string): boolean {
    if (!this.enabled) {
      this.stats.tickForwarded += 1;
      return true;
    }
    const now = this.now();
    const entry = this.entries.get(key);

    if (!entry || now - entry.lastSent >= this.windowMs) {
      // Leading edge. A key at/past its window boundary can have no armed timer
      // (the timer would have fired first), so there is nothing to cancel.
      this.entries.set(key, { lastSent: now, lastSeen: now });
      this.stats.tickForwarded += 1;
      this.scheduleSweep();
      return true;
    }

    entry.lastSeen = now;
    // Latest-wins: an already-held frame is superseded and never sent. Safe
    // only because each frame is a FULL snapshot.
    if (entry.pending) this.stats.tickCoalesced += 1;
    entry.pending = { msg, sessionId };
    if (!entry.timer) {
      const delay = entry.lastSent + this.windowMs - now;
      entry.timer = setTimeout(() => this.fire(key), Math.max(0, delay));
    }
    this.scheduleSweep();
    return false;
  }

  /**
   * A run reached `tool_execution_end`. Discard (never flush) its held frame,
   * clear its timer and drop the key.
   */
  onTerminal(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.pending) this.stats.tickDiscardedAtTerminal += 1;
    this.entries.delete(key);
  }

  /** Session change / shutdown: clear every timer, drop every held frame. */
  reset(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.entries.clear();
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  /** Trailing-edge send for `key`, gated at FIRE time. */
  private fire(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.timer = undefined;
    const held = entry.pending;
    entry.pending = undefined;
    if (!held) return;
    entry.lastSent = this.now();
    if (!this.opts.canSend(held.sessionId)) {
      this.stats.tickDroppedNotReady += 1;
      return;
    }
    this.stats.tickForwarded += 1;
    this.opts.send(held.msg);
  }

  /**
   * Keep exactly one sweep timer armed while any key is tracked. Re-armed from
   * the sweep itself, so an idle key is always reached within one TTL of its
   * last tick even if no further ticks arrive to drive a lazy sweep.
   */
  private scheduleSweep(): void {
    if (this.sweepTimer || this.entries.size === 0) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined;
      this.sweep();
      this.scheduleSweep();
    }, this.idleTtlMs);
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeen < this.idleTtlMs) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.entries.delete(key);
    }
  }
}

/**
 * The D2 scope predicate: is this `tool_execution_update` a SUBAGENT tick?
 *
 * Deliberately an allowlist of the same self-selecting pair the client's
 * durable hydration block keys on (`toolName === "Agent"` AND a
 * `partialResult.details.agentId`). A `Bash` update carrying an
 * agentId-lookalike, or an `Agent` update without one, is NOT throttled: an
 * over-matching predicate would silently rate-limit an unrelated streaming
 * tool, and the D6 counters are the tripwire for exactly that.
 */
export function isSubagentTick(event: {
  toolName?: unknown;
  partialResult?: unknown;
}): boolean {
  if (event.toolName !== "Agent") return false;
  const partial = event.partialResult as { details?: unknown } | undefined;
  if (!partial || typeof partial !== "object") return false;
  const details = partial.details as { agentId?: unknown } | undefined;
  return Boolean(details && typeof details === "object" && typeof details.agentId === "string");
}
