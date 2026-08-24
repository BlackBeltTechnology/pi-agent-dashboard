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
  /** Lowest gap seq the store can still serve. */
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
}

export function createHistoryGapState(
  window: { headMaxSeq: number; tailMinSeq: number; gapCount: number; oldestGapSeq: number },
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
 */
export function nextBackfillRange(gap: HistoryGapState): { fromSeq: number; toSeq: number } {
  const toSeq = gap.tailMinSeq - 1;
  return { fromSeq: Math.max(gap.headMaxSeq + 1, toSeq - BACKFILL_MAX_SPAN + 1), toSeq };
}
