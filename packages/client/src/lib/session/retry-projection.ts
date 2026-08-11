import type { SessionState } from "../chat/event-reducer.js";

/**
 * The card-side projection of per-session retry state.
 *
 * `retrySessionIds` answers only "is this session retrying?" and has four
 * consumers (card, list, folder capsule, status visuals). `retryAttemptMap`
 * carries the attempt NUMBER for the one consumer that renders it
 * (`ActivityIndicator`), so the membership question stays untouched.
 * See change: unify-retry-visibility (design D5).
 */
export interface RetryProjection {
  retrySessionIds: Set<string>;
  retryAttemptMap: Map<string, number>;
}

/**
 * Project `retryState` across every session.
 *
 * Membership is `retryState` set — full stop. It is deliberately NOT gated on
 * `!lastError`: a provider retry normally carries BOTH, because the error card
 * is up *while* pi retries, so the old `!state.lastError` clause excluded
 * precisely the common case the user is looking at. The gate removal is
 * visually inert for the dot / shape / rail / capsule channels — every one of
 * those checks `hasError` first, so the error branch still wins there.
 * See change: unify-retry-visibility (design D3).
 */
export function deriveRetryProjection(
  sessionStates: Iterable<[string, SessionState]>,
): RetryProjection {
  const retrySessionIds = new Set<string>();
  const retryAttemptMap = new Map<string, number>();
  for (const [id, state] of sessionStates) {
    if (!state.retryState) continue;
    retrySessionIds.add(id);
    retryAttemptMap.set(id, state.retryState.attempt);
  }
  return { retrySessionIds, retryAttemptMap };
}
