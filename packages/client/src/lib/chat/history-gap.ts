/**
 * Client-side bookkeeping for the head/tail replay window.
 *
 * The server may bound a full-stream replay to `maxReplayEvents`, delivering a
 * HEAD segment and a TAIL segment with a gap between them. That gap is
 * disclosed by `history_window` and filled on demand by `history_backfill`.
 *
 * The governing UX constraint: if the user never learns events were elided,
 * windowing is indistinguishable from data loss. The divider's primary job is
 * ANNOUNCING the gap (Nielsen H1); loading it is only secondary.
 *
 * See change: lazy-load-session-history (D5, D6, D10, D12).
 */
import type { ChatMessage } from "./event-reducer.js";

/**
 * Stable id of the synthetic divider row. Singleton per session: the gap is
 * bounded on both sides, so there is exactly one, and it is spliced out
 * entirely once filled.
 */
export const HISTORY_GAP_ROW_ID = "__history_gap__";

export interface HistoryGapState {
  /** Last seq the client holds in the head. ADVANCES as backfill fills the gap. */
  headMaxSeq: number;
  /**
   * First seq of the tail segment. RETREATS as backfill fills the gap from the
   * tail side — updated from `servedFrom`, never from arithmetic.
   * See change: fix-lazy-history-backfill-ux (D2).
   */
  tailMinSeq: number;
  /** Events the store still holds in the gap. Never the seq distance. */
  gapCount: number;
  /**
   * Lowest gap seq the store can still serve.
   *
   * LOAD-BEARING in a head-free window, where nothing else bounds the gap from
   * below: it is both the walk's termination bound and the only discriminator
   * between the two exhausted outcomes. It answers "is there anything below",
   * NEVER "why is it gone" — retention and replay compaction stay
   * indistinguishable. See change: add-tail-only-replay-window (D5, D6).
   */
  oldestGapSeq: number;
  /** A `history_backfill` is out; the divider shows state A2. */
  pending: boolean;
  /**
   * A request was refused. Collapses EVERY protocol code to one boolean: the
   * divider shows a single plain-language line plus a retry, never a code.
   * `in_flight` and `stale_generation` are transient races the user cannot act
   * on differently, so distinguishing them adds choice without adding agency.
   */
  failed: boolean;
  /**
   * The gap exists but the store cannot serve any more of it (state A5). NOT
   * an error: nothing failed, the events were trimmed. Rendering it as an
   * error would misattribute a retention policy to a fault.
   */
  unservable: boolean;
  /** True once the divider row has been placed in this replay's transcript. */
  dividerPlaced: boolean;
  /**
   * Set only when the initial replay has TERMINATED (`isLast: true`). Backfill
   * stays disarmed until then: for an evicted cold session the store is empty
   * until hydration finishes, so an early request would return empty with
   * `remainingGapCount: 0`, and then hydration would land and the same session
   * would suddenly have a servable gap — availability flapping across
   * hydration. See change: lazy-load-session-history (D11).
   */
  armed: boolean;
  /**
   * The walk has reached `oldestGapSeq`: there is nothing further to request.
   *
   * Distinct from `unservable`. `unservable` is state A5 — the gap exists and
   * the store cannot serve it. `atFloor` is a SUCCESSFUL end of the walk. In a
   * head-free window the difference is the whole point: with no head above it,
   * labelling "reached the floor" as "nothing servable" would tell the user
   * their history is broken when it is merely finished.
   * See change: add-tail-only-replay-window (D6).
   */
  atFloor: boolean;
  /**
   * SHAPE of the window this gap describes, as ANNOUNCED by the server.
   * Absent on the wire → `head-tail`, which is what a server that never sets
   * the mode always sends.
   *
   * Read rather than inferred from `headMaxSeq === 0`: the sentinel overloads
   * a numeric bound with a mode signal and fails silently.
   * See change: add-tail-only-replay-window (D2a).
   */
  windowShape: "head-tail" | "tail-only";
}

/** Whether this gap has no head segment above it. */
export function isHeadFree(gap: Pick<HistoryGapState, "windowShape">): boolean {
  return gap.windowShape === "tail-only";
}

/**
 * Which terminal row a head-free gap has resolved to, or `null` when it has
 * not resolved to one.
 *
 * A two-sided gap NEVER returns a terminus: the head above it explains where
 * the transcript begins, so its divider is spliced out on exhaustion. A
 * head-free gap has nothing to explain the beginning, so removing the row
 * would leave a transcript that silently starts mid-conversation.
 * See change: add-tail-only-replay-window (D6).
 */
export function historyGapTerminus(gap: HistoryGapState): "session-start" | "not-retained" | null {
  if (!isHeadFree(gap) || !gap.atFloor) return null;
  return gap.oldestGapSeq <= 1 ? "session-start" : "not-retained";
}

export function createHistoryGapState(
  window: {
    headMaxSeq: number;
    tailMinSeq: number;
    gapCount: number;
    oldestGapSeq: number;
    windowShape?: "head-tail" | "tail-only";
  },
): HistoryGapState {
  return {
    headMaxSeq: window.headMaxSeq,
    tailMinSeq: window.tailMinSeq,
    gapCount: window.gapCount,
    oldestGapSeq: window.oldestGapSeq,
    pending: false,
    failed: false,
    unservable: false,
    dividerPlaced: false,
    armed: false,
    atFloor: false,
    // Absent → `head-tail`: an older server never sets the field, and
    // `head-tail` is the only shape it can produce.
    windowShape: window.windowShape ?? "head-tail",
  };
}

/** The synthetic interstitial row. Carries no content — the divider reads the gap state. */
export function createHistoryGapRow(): ChatMessage {
  return { id: HISTORY_GAP_ROW_ID, role: "historyGap", content: "", timestamp: Date.now() };
}

/** Mirrors the server's own ceiling on one `history_backfill` response. */
const BACKFILL_MAX_SPAN = 500;

/**
 * The seq range to request next: the slice ADJACENT TO THE TAIL, bounded by the
 * server's own `BACKFILL_MAX_SPAN` and floored at the head edge.
 *
 * Tail-anchored, because "Load earlier" must deliver the events IMMEDIATELY
 * PRECEDING what the user is reading — the chat-app behaviour. The previous
 * head-first direction existed only because `headMaxSeq` was the one mutable
 * edge; the gap is symmetric now, so the server retreats `tailMinSeq` on a
 * tail-adjacent range exactly as it advances `headMaxSeq` on a head-adjacent
 * one, and the loop still terminates on the store-read `remainingGapCount`.
 * See change: fix-lazy-history-backfill-ux (D1, D2).
 *
 * In a HEAD-FREE window the lower bound is the store FLOOR (`oldestGapSeq`)
 * rather than the head edge, keyed on the ANNOUNCED `windowShape` and never on
 * `headMaxSeq === 0`. Flooring makes "a request entirely below the floor"
 * unreachable, so the walk never spends a round trip to learn it is done — and
 * never lands on the empty-response branch that would mislabel *reached the
 * floor* as *nothing servable*.
 * See change: add-tail-only-replay-window (D5).
 */
export function nextBackfillRange(gap: HistoryGapState): { fromSeq: number; toSeq: number } {
  const toSeq = gap.tailMinSeq - 1;
  const floor = isHeadFree(gap) ? gap.oldestGapSeq : gap.headMaxSeq + 1;
  return { fromSeq: Math.max(floor, toSeq - BACKFILL_MAX_SPAN + 1), toSeq };
}

/**
 * How long motion must be QUIET before the trigger is evaluated.
 *
 * Momentum IS a stream of scroll events, each restarting this timer, so
 * evaluating only at expiry makes the predicate run exactly once per gesture —
 * without the caller knowing anything about touch, inertia, or platform. No
 * `onTouchStart` / `onTouchEnd`: WebKit fires `touchend` BEFORE inertial
 * scrolling begins, so clearing a latch there re-enables the trigger during
 * exactly the momentum phase that must be deferred.
 *
 * 120ms is the aggressive end of the usable range, chosen deliberately: WebKit
 * inertia can emit events for 100-300ms after `touchend`, so on a slow device
 * momentum may outlast the window and produce one early fetch — of data the
 * user is scrolling toward anyway. A 400ms window makes the loading head feel
 * dead, which is the worse failure.
 * See change: add-tail-only-replay-window (D7).
 */
export const SETTLE_MS = 120;

/** Booleans only — `ChatView` owns the timer, the stamp, and the intent flag. */
export interface TriggerInputs {
  /** The window has no head segment (announced `windowShape`, never a sentinel). */
  headFree: boolean;
  /** The loading head is within the proximity band. */
  nearTop: boolean;
  /** The user has asked to go up SINCE the last request. */
  pendingUserIntent: boolean;
  /** This evaluation falls inside a programmatic-scroll suppression window. */
  suppressed: boolean;
  armed: boolean;
  pending: boolean;
  failed: boolean;
  unservable: boolean;
  atFloor: boolean;
}

/**
 * Whether an automatic `history_backfill` should be issued now.
 *
 * PURE, and it tracks INTENT rather than position. Two weaker rules were
 * rejected and both stall: a scroll-DELTA rule fails because `scrollTop` clamps
 * at `0`, so a user parked on the loading head produces no further upward
 * delta; a RISING-EDGE-of-proximity rule fails one step later, because a splice
 * smaller than the proximity band leaves the user still `nearTop` and no new
 * edge is ever produced.
 *
 * `pendingUserIntent`, cleared by the caller ON ISSUE, is what bounds this to
 * one request per expression of intent — a splice cannot chain-load, because
 * its own scroll events are stamped and the flag was already cleared. Clearing
 * it at mount and on session change is what kills the first-paint and
 * session-restore cases, where a restored transcript can land at
 * `scrollTop === 0` with no intent ever recorded.
 *
 * A SUPPRESSED evaluation must be DEFERRED, not consumed: the caller changes no
 * state on a `false` from suppression and re-evaluates when the stamp lapses.
 * See change: add-tail-only-replay-window (D7).
 */
export function shouldAutoLoadHistory(t: TriggerInputs): boolean {
  return (
    t.headFree &&
    t.nearTop &&
    t.pendingUserIntent &&
    !t.suppressed &&
    t.armed &&
    !t.pending &&
    !t.failed &&
    !t.unservable &&
    !t.atFloor
  );
}
