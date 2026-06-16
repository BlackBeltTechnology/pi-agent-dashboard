/**
 * Per-session "history loading" flag helpers.
 *
 * The flag is set when the client sends `subscribe` for a session and cleared
 * the instant content arrives, replay completes, the load fails, or a
 * safety-net timeout elapses. `ChatView` reads the selected session's value to
 * distinguish "history in flight" from "genuinely empty session".
 * See change: show-chat-history-loading-indicator.
 */
import type React from "react";

export type LoadingHistorySetter = React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
export type LoadingHistoryTimersRef = React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;

/**
 * Clear the loading flag for `id` and tear down its safety-net timer.
 * Idempotent: a no-op if the flag is already false and no timer is armed.
 */
export function clearLoadingHistory(
  setLoadingHistory: LoadingHistorySetter,
  timersRef: LoadingHistoryTimersRef,
  id: string,
): void {
  const timer = timersRef.current.get(id);
  if (timer) {
    clearTimeout(timer);
    timersRef.current.delete(id);
  }
  setLoadingHistory((prev) => {
    if (!prev.get(id)) return prev;
    const next = new Map(prev);
    next.set(id, false);
    return next;
  });
}
