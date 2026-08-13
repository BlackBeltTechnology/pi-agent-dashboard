/**
 * Chat-refresh coordinator.
 *
 * Extracted from `App.tsx` (where the same block was duplicated behind the
 * header and mobile `onRefresh` props) so the ORDERING guarantee — durable
 * invalidation BEFORE the in-memory reset — is unit-testable without mounting
 * the whole app. Same pattern as `lib/api/server-switch.ts`.
 *
 * Why the durable delete goes first: a surviving cache entry is not inert, it is
 * AUTHORITATIVE. `rehydrateSession` returns the entry's `maxSeq` as the subscribe
 * cursor, so the server delta-replays only the tail and the stale state stays as
 * the base of the rendered view. Resetting memory first and deleting second would
 * mean an interrupted refresh (page unload) leaves an in-memory reset paired with
 * a surviving entry — a stale base plus a fresh tail. Deleting first makes an
 * interruption leave BOTH layers untouched instead, which is a consistent
 * pre-refresh state.
 *
 * See change: purge-replay-cache-on-reset-paths.
 */

export interface RefreshChatDeps {
  /** Invalidate the durable entry + in-memory replay buffer for this session. */
  dropPersisted: (sessionId: string) => Promise<void>;
  /** Reset the reduced chat state to an empty session. */
  resetSessionState: (sessionId: string) => void;
  /** Zero the live replay cursor so the resubscribe is a full replay. */
  resetCursor: (sessionId: string) => void;
  /** Re-assert the subscription bookkeeping entry. */
  markSubscribed: (sessionId: string) => void;
  /** Send `subscribe` with `lastSeq: 0`. */
  subscribe: (sessionId: string) => void;
  /** Arm the "history loading" indicator. */
  beginLoadingHistory: (sessionId: string) => void;
  /**
   * Arm the "replay in flight" indicator. Separate from `beginLoadingHistory`:
   * that one owns its own setter/timers, this one drives the streaming pill.
   * See change: show-replay-in-flight-indicator.
   */
  beginReplayInFlight: (sessionId: string) => void;
}

/**
 * Refresh one session's chat: invalidate durably, then reset and resubscribe.
 *
 * A failed invalidation never aborts the refresh. The durable store may be
 * permanently unavailable (private browsing, disabled storage), and the refresh
 * is the user's escape hatch precisely when the view looks wrong — a refresh that
 * silently did nothing there would be the worse failure. The residual (a stale
 * entry surviving to the NEXT page load) is accepted; see the change's design D6.
 */
export async function refreshChat(sessionId: string, deps: RefreshChatDeps): Promise<void> {
  try {
    await deps.dropPersisted(sessionId);
  } catch {
    // Optimization-only layer: degrade, never block the refresh.
  }
  deps.resetSessionState(sessionId);
  deps.resetCursor(sessionId);
  deps.markSubscribed(sessionId);
  deps.subscribe(sessionId);
  deps.beginLoadingHistory(sessionId);
  // Refresh resubscribes at lastSeq 0 — a full replay, precisely what the
  // in-flight pill reports. Armed here rather than at the two call sites so the
  // header and mobile paths cannot drift.
  deps.beginReplayInFlight(sessionId);
}
