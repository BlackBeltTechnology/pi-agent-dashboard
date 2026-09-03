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
   * Whether the ANNOUNCED gap was holey — it held fewer events than its seq
   * span, so retention trimmed its MIDDLE. Computed once at announce time
   * (`gapCount < tailMinSeq − headMaxSeq − 1`, from the `history_window` the
   * client already receives — no wire change, no extra request) and scoped to
   * two-sided windows: for a head-free window the formula would misread a
   * trimmed BEGINNING as a trimmed middle, so it is forced false there.
   *
   * Consulted only on the two-sided exhaustion branch, where it decides
   * between removing the divider (contiguous) and resolving to the
   * not-retained terminus (holey).
   * See change: fix-history-backfill-holey-store (D6).
   */
  holey: boolean;
  /**
   * The two-sided walk is over AND the gap was holey: the interstitial
   * resolves to the not-retained terminus instead of being removed, because
   * removing it would render head and tail as if they were adjacent.
   *
   * A DEDICATED flag, deliberately not a reuse of `atFloor`: `atFloor` is
   * documented as the head-free store-floor bound, and overloading it would
   * muddy that meaning.
   * See change: fix-history-backfill-holey-store (D6).
   */
  twoSidedTerminus: boolean;
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
   * The head-free walk has reached `oldestGapSeq`: there is nothing further to
   * request. A SUCCESSFUL end of the walk — in a head-free window, with no
   * head above it, labelling "reached the floor" as "nothing servable" would
   * tell the user their history is broken when it is merely finished.
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
 * Which terminal row a gap has resolved to, or `null` when it has not
 * resolved to one.
 *
 * A head-free gap resolves on `atFloor`: nothing above it explains where the
 * transcript begins, so removing the row would leave one that silently starts
 * mid-conversation. A two-sided gap resolves on `twoSidedTerminus` ONLY when
 * it was holey — retention trimmed its middle, and removing the row would
 * render head and tail as if they were adjacent; a CONTIGUOUS two-sided gap
 * has its divider spliced out instead (the head explains the beginning, and
 * nothing was elided from the middle). The two-sided terminus is always
 * `not-retained`: `session-start` is meaningless with a head segment above.
 * See change: add-tail-only-replay-window (D6),
 * fix-history-backfill-holey-store (D6).
 */
export function historyGapTerminus(gap: HistoryGapState): "session-start" | "not-retained" | null {
  if (isHeadFree(gap)) {
    if (!gap.atFloor) return null;
    return gap.oldestGapSeq <= 1 ? "session-start" : "not-retained";
  }
  return gap.twoSidedTerminus ? "not-retained" : null;
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
  // Absent → `head-tail`: an older server never sets the field, and
  // `head-tail` is the only shape it can produce.
  const windowShape = window.windowShape ?? "head-tail";
  return {
    headMaxSeq: window.headMaxSeq,
    tailMinSeq: window.tailMinSeq,
    gapCount: window.gapCount,
    oldestGapSeq: window.oldestGapSeq,
    pending: false,
    failed: false,
    // Announce-time snapshot of whether the announced gap was holey — taken
    // BEFORE the walk mutates the bounds, which is what makes the original
    // span recoverable here and nowhere later.
    holey: windowShape === "head-tail" && window.gapCount < window.tailMinSeq - window.headMaxSeq - 1,
    twoSidedTerminus: false,
    dividerPlaced: false,
    armed: false,
    atFloor: false,
    windowShape,
  };
}

/** The synthetic interstitial row. Carries no content — the divider reads the gap state. */
export function createHistoryGapRow(): ChatMessage {
  return { id: HISTORY_GAP_ROW_ID, role: "historyGap", content: "", timestamp: Date.now() };
}

/**
 * The seq range to request next: the FULL remaining gap — `toSeq` at the tail
 * edge, `fromSeq` at the floor.
 *
 * Tail-anchored, because "Load earlier" must deliver the events IMMEDIATELY
 * PRECEDING what the user is reading — the chat-app behaviour. The server
 * retreats `tailMinSeq` on a tail-adjacent range exactly as it advances
 * `headMaxSeq` on a head-adjacent one, and the loop terminates on the
 * store-read `remainingGapCount`.
 * See change: fix-lazy-history-backfill-ux (D1, D2).
 *
 * No client-side seq window: the server's cap is an EVENT COUNT now, so the
 * newest N events are selected from ANYWHERE in the requested range — capping
 * the request's seq span instead would select only the top 500 seqs, which on
 * a holey store frequently hold nothing. The count cap, not a seq window,
 * decides how much comes back.
 * See change: fix-history-backfill-holey-store (D2).
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
  return { fromSeq: floor, toSeq };
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
    !t.atFloor
  );
}
