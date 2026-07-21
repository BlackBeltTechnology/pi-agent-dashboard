// Frame-coalesced live-event folding for the WebSocket `event` path.
//
// Live `event` messages arrive in separate macrotasks (one WS frame each), so
// React 18 automatic batching does NOT merge their `setSessionStates` calls.
// A burst of N events therefore produced N reducer passes and N renders of the
// (now memoized) ChatView. This helper folds a queued burst into a single
// SessionState so the flush applies one state update per frame.
//
// See change: reduce-chat-render-cpu-umbrella (Phase 3).

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { reduceEvent, type SessionState } from "./event-reducer.js";

export interface QueuedLiveEvent {
  seq: number;
  event: DashboardEvent;
}

/**
 * Fold a queued burst of live events into a single SessionState.
 *
 * Events are applied through `reduceEvent(..., { isLive: true })` in ascending
 * `seq` order — exactly as the per-event live path did. Returns the folded
 * state plus the maximum `seq` observed (for `maxSeqMapRef`).
 *
 * Invariant (verified by test): the returned state is identical to applying
 * the same events one-by-one via `reduceEvent` in seq order, and `maxSeq`
 * equals the batch maximum seq.
 */
export function foldLiveEvents(
  current: SessionState,
  queued: readonly QueuedLiveEvent[],
): { state: SessionState; maxSeq: number } {
  // Copy before sorting: never mutate the caller's queue array in place.
  const sorted = [...queued].sort((a, b) => a.seq - b.seq);
  let state = current;
  let maxSeq = Number.NEGATIVE_INFINITY;
  for (const { seq, event } of sorted) {
    state = reduceEvent(state, event, { isLive: true });
    if (seq > maxSeq) maxSeq = seq;
  }
  return { state, maxSeq };
}
