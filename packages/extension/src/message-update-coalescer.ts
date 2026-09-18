/**
 * MessageUpdateCoalescer — bounds the bridge's per-token forwarding cost during
 * assistant streaming.
 *
 * pi's `message_update` carries the FULL accumulated text snapshot, not a delta,
 * and the bridge forwarded every one of them synchronously on pi's own
 * single-threaded loop. A turn of N tokens therefore paid N `JSON.stringify`
 * calls on strings growing to O(N) — O(N²) bytes — and stalled the TUI with it.
 *
 * This module is a transport-agnostic single-slot state machine (only one
 * assistant message streams at a time in pi). The bridge injects `send`, the
 * timer schedule/cancel, and a liveness predicate, so every ordering rule below
 * is provable with fake timers rather than only through the end-to-end bridge
 * test.
 *
 * Three rules are load-bearing and easy to lose:
 *
 *  - **Fixed window, not a debounce.** The window is anchored at the arrival of
 *    the first pending update and is NOT restarted by later ones. A debounce
 *    would starve: a continuous token stream never sees a gap, so the first
 *    snapshot would land only at `message_end` and nothing would stream. A fixed
 *    window bounds added latency at exactly one window and keeps it
 *    non-cumulative.
 *  - **TEXT coalesces, everything else flushes then forwards.** Only
 *    `text_start`/`text_delta`/`text_end` are snapshot-carrying. Thinking deltas
 *    are ADDITIVE, not snapshot-carrying, so coalescing them would silently
 *    swallow them. Unknown sub-event types take the same immediate path as the
 *    known non-text ones: a future additive sub-event must not be swallowed.
 *  - **Drop rule is narrow and fail-open.** ONLY an update whose identity has
 *    already been closed by `messageEnd` is discarded. An update with no open
 *    message, or with an identity the coalescer never saw open, opens one
 *    instead. `npm run reload` re-inits the bridge mid-turn, so the fresh
 *    instance never saw that message's `message_start`; dropping there would
 *    silence the rest of the turn.
 *
 * The pending slot holds the LIVE event, not a copy: `partial` is the same
 * object pi mutates in place for the whole message, so a copy would only buy a
 * point-in-time distinction the consumer cannot observe — while paying the
 * per-token serialisation this module exists to remove. Snapshots are
 * cumulative and the client is last-wins, so a flushed snapshot carrying
 * content that arrived after the update it nominally represents is safe.
 *
 * See change: coalesce-bridge-message-update-snapshots (design D1–D4, D7).
 */

/** Fixed coalescing window: ~20 frames/s, an order of magnitude above a fast
 * provider's per-token interval and below the ~100 ms "instant" threshold. */
export const COALESCE_WINDOW_MS = 50;

/**
 * The snapshot-carrying sub-events. Everything else — including sub-events this
 * build does not recognise — flushes pending text and forwards immediately.
 */
const TEXT_SUB_EVENTS: ReadonlySet<string> = new Set([
  "text_start",
  "text_delta",
  "text_end",
]);

/**
 * Closed identities remembered for the drop rule. A straggler arrives within one
 * window of its `message_end`, so a small FIFO is ample; the cap keeps a
 * long-lived session's key set bounded.
 */
const CLOSED_KEY_MEMORY = 64;

export interface MessageUpdateCoalescerOptions<E> {
  /** Write a flushed event. Called at most once per armed window. */
  send: (event: E) => void;
  /** Arm the window timer. Injectable so unit tests drive a fake clock. */
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel an armed window timer (also used to release it from any registry). */
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  /** Window length. Defaults to {@link COALESCE_WINDOW_MS}. */
  windowMs?: number;
  /**
   * Fire-time liveness gate. A window that outlives its bridge (reload,
   * shutdown) must not write to a dead socket, so the timer path re-checks it
   * instead of trusting the state captured when the timer was armed.
   */
  isActive?: () => boolean;
}

interface PendingSnapshot<E> {
  event: E;
  key: string;
  gen: number;
}

export class MessageUpdateCoalescer<E = unknown> {
  private readonly windowMs: number;
  private readonly isActive: () => boolean;

  /** The single parked snapshot, if any. */
  private pending?: PendingSnapshot<E>;
  /** The armed window timer, if a snapshot is parked. */
  private timer?: ReturnType<typeof setTimeout>;

  /** The identity of the currently open message, if any. */
  private openKey?: string;
  private openGen?: number;

  /** Identities already closed by `messageEnd` (bounded FIFO). */
  private readonly closedKeys = new Set<string>();
  private readonly closedOrder: string[] = [];

  /** Stable fallback identities for messages with no usable `timestamp`. */
  private readonly fallbackIds = new WeakMap<object, string>();
  private fallbackCounter = 0;

  constructor(private readonly opts: MessageUpdateCoalescerOptions<E>) {
    this.windowMs = opts.windowMs ?? COALESCE_WINDOW_MS;
    this.isActive = opts.isActive ?? (() => true);
  }

  /**
   * Stable identity for a message: `<gen>:<role>:<timestamp>`.
   *
   * `message.id` is unusable (pi stamps it only at post-handler persistence, so
   * it does not exist while the message streams). The generation is folded INTO
   * the key rather than compared separately: `role:timestamp` alone collides for
   * two messages created in the same millisecond (retry loop, mock provider,
   * coarse clock), and a `message_update` carries no generation of its own.
   *
   * `timestamp` is a required pi field, but a fallback keeps a malformed or
   * older event from collapsing every key and swallowing a whole turn: the
   * object identity pins one counter value for the message's lifetime.
   */
  keyOf(gen: number, message: unknown): string {
    const m = (message ?? undefined) as { role?: unknown; timestamp?: unknown } | undefined;
    const role = typeof m?.role === "string" ? m.role : "unknown";
    const timestamp = typeof m?.timestamp === "number" ? String(m.timestamp) : undefined;
    if (timestamp !== undefined) return `${gen}:${role}:${timestamp}`;
    if (!m || typeof m !== "object") return `${gen}:${role}:anonymous`;
    let id = this.fallbackIds.get(m as object);
    if (id === undefined) {
      id = `f${++this.fallbackCounter}`;
      this.fallbackIds.set(m as object, id);
    }
    return `${gen}:${role}:${id}`;
  }

  /** `message_start` (user or assistant) opens the lifecycle for `key`. */
  messageStart(gen: number, key: string): void {
    // A new identity supersedes a parked snapshot of a different one: flush it
    // rather than let it land after this message begins.
    if (this.pending && this.pending.key !== key) this.flush();
    // Re-opening a key forgets its closed marker (retry/resume of the same id).
    this.closedKeys.delete(key);
    this.openKey = key;
    this.openGen = gen;
  }

  /**
   * `message_end` closes `key`. The bridge flushes the final snapshot BEFORE
   * calling this — closing first would drop the last text of a turn.
   */
  messageEnd(gen: number, key: string): void {
    // A deferred `messageEnd` from an older generation must not close a newer
    // open message.
    if (this.openKey === key && this.openGen === gen) {
      this.openKey = undefined;
      this.openGen = undefined;
    }
    this.markClosed(key);
  }

  /**
   * Offer a `message_update` for its `gen`.
   *
   * Text-carrying sub-events park (last wins) until the window elapses; every
   * other sub-event flushes pending text and then forwards immediately, so
   * source order is preserved and additive sub-events stay lossless.
   */
  offer(event: E, gen: number): void {
    const key = this.keyOf(gen, (event as { message?: unknown } | undefined)?.message);
    // The ONLY drop: an identity already closed by `messageEnd`.
    if (this.closedKeys.has(key)) return;

    if (this.openKey !== key) {
      // Either no message is open (reload mid-turn) or this is an identity the
      // barrier never saw. Flush what belongs to the old one, then re-key.
      if (this.pending) this.flush();
      this.openKey = key;
      this.openGen = gen;
    }

    if (isTextSubEvent(event)) {
      this.park(event, key, gen);
      return;
    }
    // Non-text (and unrecognised): flush first so the snapshot keeps its place
    // in the source order, then forward unmodified.
    this.flush();
    this.opts.send(event);
  }

  /**
   * Write the parked snapshot now. Synchronous and idempotent — a second call
   * with nothing parked is a no-op. Called by the window timer and by the
   * bridge's flush choke point at every non-`message_update` handler entry.
   */
  flush(): void {
    this.disarm();
    const held = this.pending;
    this.pending = undefined;
    if (!held) return;
    this.opts.send(held.event);
  }

  /**
   * Session boundary: drop any parked snapshot, cancel the window, close the
   * lifecycle and forget the closed-identity memory (a new session shares none
   * of the old one's messages).
   */
  clear(): void {
    this.disarm();
    this.pending = undefined;
    this.openKey = undefined;
    this.openGen = undefined;
    this.closedKeys.clear();
    this.closedOrder.length = 0;
  }

  /** Whether a snapshot is parked (test/introspection aid). */
  get hasPending(): boolean {
    return this.pending !== undefined;
  }

  /** Park `event` as the pending snapshot, arming the window if it is the first. */
  private park(event: E, key: string, gen: number): void {
    const alreadyArmed = this.pending !== undefined;
    this.pending = { event, key, gen };
    if (!alreadyArmed) {
      this.timer = this.opts.setTimer(() => this.onWindow(), this.windowMs);
    }
  }

  /**
   * Window elapsed. Re-checks liveness: a timer that outlived its bridge
   * (reload/shutdown) drops the snapshot instead of writing to a dead socket.
   */
  private onWindow(): void {
    // `clearTimer` on a fired timer is a harmless no-op that still releases it
    // from the bridge's timer registry.
    this.disarm();
    if (!this.isActive()) {
      this.pending = undefined;
      return;
    }
    const held = this.pending;
    this.pending = undefined;
    if (held) this.opts.send(held.event);
  }

  /** Release the armed window timer, if any. */
  private disarm(): void {
    if (this.timer === undefined) return;
    this.opts.clearTimer(this.timer);
    this.timer = undefined;
  }

  private markClosed(key: string): void {
    if (this.closedKeys.has(key)) return;
    this.closedKeys.add(key);
    this.closedOrder.push(key);
    while (this.closedOrder.length > CLOSED_KEY_MEMORY) {
      const evicted = this.closedOrder.shift();
      if (evicted !== undefined) this.closedKeys.delete(evicted);
    }
  }
}

/**
 * Whether an event must flush parked text BEFORE its own handler runs.
 *
 * EVERY event except `message_update` does. Naming the rule here (rather than
 * inlining the comparison at each call site) keeps the bridge's hard invariant —
 * "no non-`message_update` event may reach the wire, defer, or early-return
 * while a snapshot is parked" — a single, unit-testable predicate. A new
 * early-returning branch inherits it because the bridge checks it ONCE at
 * handler entry, before any branch runs.
 *
 * See change: coalesce-bridge-message-update-snapshots (D5).
 */
export function flushesParkedText(eventType: string): boolean {
  return eventType !== "message_update";
}

/** The `message_update` sub-event type, if the event carries one. */
function subEventTypeOf(event: unknown): string | undefined {
  const type = (event as { assistantMessageEvent?: { type?: unknown } } | undefined)
    ?.assistantMessageEvent?.type;
  return typeof type === "string" ? type : undefined;
}

/**
 * Whether this `message_update` carries a full text snapshot. Only the three
 * `text_*` sub-events do; an unrecognised type is deliberately NOT treated as
 * text (forwarding it immediately is the safe side of the fail-open choice).
 */
export function isTextSubEvent(event: unknown): boolean {
  const type = subEventTypeOf(event);
  return type !== undefined && TEXT_SUB_EVENTS.has(type);
}
