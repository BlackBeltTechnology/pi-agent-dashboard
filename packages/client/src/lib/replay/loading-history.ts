/**
 * Per-session "history loading" flag helpers.
 *
 * The flag is set when the client sends `subscribe` for a session and cleared
 * the instant content arrives, replay completes, the load fails, or a
 * safety-net timeout elapses. These helpers are FLAG-GENERIC over
 * `(setter, timersRef, id)` and are reused verbatim for the second per-session
 * flag, `replayInFlight`, which clears on the terminal batch rather than on
 * first content (see change: show-replay-in-flight-indicator).
 * `ChatView` reads the selected session's value to
 * distinguish "history in flight" from "genuinely empty session".
 * See change: show-chat-history-loading-indicator.
 *
 * Two-stage safety net (See change: fix-history-loading-false-empty-flash):
 * `beginLoadingHistory` arms the short `SUBSCRIBE_ACK_MS` window (dead-link /
 * no-ack ceiling). The server's cold-hydration start marker + heartbeats
 * (`event_replay { events: [], isLast: false }`) re-arm the longer
 * `HYDRATE_CEILING_MS` window via `rearmLoadingHistory` so a slow disk parse
 * never surfaces the "No messages yet" placeholder.
 */
import type React from "react";

/** Short window: no `subscribe` ack / dead link. Clears the flag if nothing arrives. */
export const SUBSCRIBE_ACK_MS = 15000;
/** Long window: max gap tolerated after the last cold-hydration marker/heartbeat. */
export const HYDRATE_CEILING_MS = 90000;
/**
 * Delay before the replay-in-flight pill paints, so a replay that resolves
 * quickly never flashes an indicator. A RENDER THRESHOLD, not a safety net —
 * the two windows above are the safety nets. The value is UNMEASURED pending
 * transfer-phase instrumentation; retune it once real replay durations exist.
 * See change: show-replay-in-flight-indicator.
 */
export const REPLAY_PILL_DELAY_MS = 300;

export type LoadingHistorySetter = React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
export type LoadingHistoryTimersRef = React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;

/**
 * Clear the loading flag for `id` and tear down its safety-net timer.
 * Idempotent: a no-op if the flag is already false and no timer is armed.
 */
export function clearLoadingHistory(
  setFlag: LoadingHistorySetter,
  timersRef: LoadingHistoryTimersRef,
  id: string,
): void {
  const timer = timersRef.current.get(id);
  if (timer) {
    clearTimeout(timer);
    timersRef.current.delete(id);
  }
  setFlag((prev) => {
    if (!prev.get(id)) return prev;
    const next = new Map(prev);
    next.set(id, false);
    return next;
  });
}

/**
 * Re-arm the safety-net timer for `id` with a new delay, keeping the flag set.
 * No-op when no timer is currently armed for `id` (flag already cleared /
 * session not loading) — timer presence is the invariant proxy for "flag set",
 * since `beginLoadingHistory` arms both and `clearLoadingHistory` tears both
 * down together. Used on the cold-hydration start marker and every heartbeat to
 * move from the short `SUBSCRIBE_ACK_MS` window to the longer `HYDRATE_CEILING_MS`.
 * See change: fix-history-loading-false-empty-flash.
 */
export function rearmLoadingHistory(
  setFlag: LoadingHistorySetter,
  timersRef: LoadingHistoryTimersRef,
  id: string,
  ms: number,
): void {
  const existing = timersRef.current.get(id);
  if (!existing) return;
  clearTimeout(existing);
  timersRef.current.set(
    id,
    setTimeout(() => clearLoadingHistory(setFlag, timersRef, id), ms),
  );
}
