/**
 * Plugin-facing server seams that let an event-type owner shape how core stores,
 * synthesizes and delivers its events. Core holds no plugin-specific rule: every
 * hook is called only for event types the plugin owns (manifest `eventTypes`)
 * and, for the store policy, `tool_execution_update|end` of tools it claims.
 *
 * See change: move-subagents-to-plugin (D3 store policy, D4 append/status-ended,
 * D10 delivery policy).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** One resident stored event handed to a policy through a {@link StorePolicyView}. */
export interface StorePolicyEvent {
  seq: number;
  event: DashboardEvent;
}

/**
 * Read-only window onto the session's resident events the policy owns (owned
 * types + claimed tools' updates/ends). Lazy: `resident()` walks the buffer
 * only when called, so a hook that returns early costs nothing.
 */
export interface StorePolicyView {
  /** Resident owned events, NEWEST first. Excludes the event being processed. */
  resident(): IterableIterator<StorePolicyEvent>;
  /** Count of ALL resident events of the session (cheap upper bound). */
  readonly size: number;
}

/** Context handed to `bound`: the per-event ceiling and a bounded size probe. */
export interface StorePolicyBoundContext {
  /** Per-event data ceiling in bytes (0 = disabled). */
  maxEventDataSize: number;
  /** True when `value`'s serialized size exceeds the ceiling (false when disabled). */
  exceeds(value: unknown): boolean;
}

/** Context handed to `vetoSupersede`. */
export interface StorePolicyVetoContext {
  /** True when the store still holds the first identity-carrying update of this call. */
  pinResident: boolean;
}

/**
 * Store policy. Every hook is optional. A hook that throws is treated as
 * absent for that call (the store fails open to its generic rules).
 */
export interface PluginStorePolicy {
  /**
   * Scalar identity fields of `event`, kept in the over-size `__truncated`
   * placeholder and in a synthesized heal end. Returned as a partial `data`
   * object; the store keeps only scalar leaves (depth ≤ 3), strings cut to
   * 256 B. For a claimed tool's update/end the result has the END shape
   * (`{ details: { ... } }`).
   */
  identity?(event: DashboardEvent): Record<string, unknown> | undefined;
  /**
   * A reduced copy of an OVER-ceiling owned event (never mutate `event`), or
   * `undefined` to leave it to the generic path.
   */
  elide?(event: DashboardEvent, view: StorePolicyView): DashboardEvent | undefined;
  /**
   * Called after an owned event is stored. Returns seqs of EARLIER owned
   * events to drop from the store; any other seq is ignored.
   */
  onStored?(event: DashboardEvent, view: StorePolicyView): readonly number[] | undefined;
  /**
   * Pin an owned event against store trimming (≤ 500 pins per session;
   * overflow is ignored oldest-first and counted). `view` is shared across the
   * calls of one trim pass, so per-pass state may be memoized on it.
   */
  retain?(event: DashboardEvent, view: StorePolicyView): boolean;
  /**
   * Owner bound for a streamed owned event, applied before the generic
   * ceiling. Return the event to store (unchanged or bounded) — the generic
   * string caps are then skipped — or `undefined` to continue with
   * `elide` + the generic path.
   */
  bound?(event: DashboardEvent, ctx: StorePolicyBoundContext): DashboardEvent | undefined;
  /**
   * True to keep a retained tail update that `end` (a claimed tool's
   * `tool_execution_end`) would otherwise subsume.
   */
  vetoSupersede?(end: DashboardEvent, tailUpdate: DashboardEvent, ctx: StorePolicyVetoContext): boolean;
  /**
   * True when a claimed tool's `tool_execution_update` is the identity-creating
   * tick of its call: the store keeps the FIRST such update of each tool call
   * out of the superseded-update collapse.
   */
  isCarrier?(event: DashboardEvent): boolean;
}

/**
 * Delivery policy for owned event types. `deferKey` returns the key under which
 * a per-session event frame is deferred instead of shed on a saturated socket
 * (or `undefined` for none); `project` returns the bounded copy to defer.
 * A policy that throws counts as returning no key.
 */
export interface PluginDeliveryPolicy {
  deferKey?(event: DashboardEvent, sessionId: string): string | undefined;
  project?(event: DashboardEvent): DashboardEvent;
}

/** Outcome of `ctx.appendEvent`. A refusal never throws. */
export type PluginAppendResult =
  | { ok: true; seq: number; broadcast: boolean }
  | { ok: false; reason: "not-owned" | "unsupported" };

/** Register this plugin's store policy. Returns an unregister fn. */
export type RegisterStorePolicyFn = (policy: PluginStorePolicy) => () => void;

/** Register this plugin's delivery policy. Returns an unregister fn. */
export type RegisterDeliveryPolicyFn = (policy: PluginDeliveryPolicy) => () => void;

/**
 * Store (and broadcast, unless the session is replaying) an event of a type the
 * calling plugin owns. Refused (never thrown) for any other type.
 */
export type AppendEventFn = (sessionId: string, event: DashboardEvent) => PluginAppendResult;

/**
 * Subscribe to every end transition of the `sessionManager.onEnded` seam
 * (unregister, status set to ended, a later end-reason re-fire); not fired for
 * a relocated session (`movedTo`). Handlers MUST be idempotent. Distinct from
 * `onSessionEnded`, which keeps its unregister-only semantics.
 */
export type OnSessionStatusEndedFn = (handler: (sessionId: string) => void) => () => void;

/** One stored event a replay-carry handler reads or returns (`seq` is the store seq). */
export interface ReplayCarryEvent {
  seq: number;
  event: DashboardEvent;
}

/**
 * What a replay-carry handler is called with for a windowed subscribe. `head` and
 * `tail` are the events the browser receives next; `getGapEvents()` reads the
 * RESIDENT events strictly between them (a trimmed gap yields fewer).
 */
export interface ReplayCarryContext {
  sessionId: string;
  /** First and last seq of the gap (`headMaxSeq + 1`, `tailMinSeq - 1`). */
  gapFromSeq: number;
  gapToSeq: number;
  head: readonly ReplayCarryEvent[];
  tail: readonly ReplayCarryEvent[];
  getGapEvents(): ReplayCarryEvent[];
}

/**
 * Returns stored gap events (priority order) the plugin needs to rebuild its
 * state across a windowed replay. Core keeps only owned types, truncates to
 * 2000 events / 2 MiB, discards a result later than 200 ms, and skips a throw.
 */
export type ReplayCarryHandler = (ctx: ReplayCarryContext) => ReplayCarryEvent[] | Promise<ReplayCarryEvent[]>;

/** Register this plugin's replay-carry handler. Returns an unregister fn. */
export type RegisterReplayCarryFn = (handler: ReplayCarryHandler) => () => void;
