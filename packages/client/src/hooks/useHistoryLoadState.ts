/**
 * Per-session history-load bookkeeping owned by `App`: the two replay flags
 * (`loadingHistory`, `replayInFlight`) with their safety-net timers, plus the
 * `historyLoadFailed` mark and the `historyLoadStartedAt` clock.
 *
 * Extracted from `App.tsx` so the begin / fail / reset rules are unit-testable
 * without mounting the whole app. See change: show-session-history-load-state
 * (design D2).
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { armLoadingHistoryTimer, clearLoadingHistory, SUBSCRIBE_ACK_MS } from "../lib/replay/loading-history.js";

type FlagMap = Map<string, boolean>;
type TimerMap = Map<string, ReturnType<typeof setTimeout>>;

export interface BeginLoadingHistoryOpts {
  /** A new load (refresh / Retry): restart the elapsed clock. */
  restart?: boolean;
}

export interface UseHistoryLoadStateOpts {
  /** Connection status; the transition to `"connected"` resets every session. */
  status: string;
  /** Chat-content gate (`hasChatContent`) for `id`, read at call time. */
  hasContent: (id: string) => boolean;
}

function setFlag(prev: FlagMap, id: string, value: boolean): FlagMap {
  if ((prev.get(id) ?? false) === value) return prev;
  const next = new Map(prev);
  next.set(id, value);
  return next;
}

function clearTimers(ref: React.MutableRefObject<TimerMap>): void {
  for (const t of ref.current.values()) clearTimeout(t);
  ref.current.clear();
}

export function useHistoryLoadState({ status, hasContent }: UseHistoryLoadStateOpts) {
  const [loadingHistory, setLoadingHistory] = useState<FlagMap>(new Map());
  const loadingHistoryTimersRef = useRef<TimerMap>(new Map());
  const [replayInFlight, setReplayInFlight] = useState<FlagMap>(new Map());
  const replayInFlightTimersRef = useRef<TimerMap>(new Map());
  const [historyLoadFailed, setHistoryLoadFailed] = useState<FlagMap>(new Map());
  const [historyLoadStartedAt, setHistoryLoadStartedAt] = useState<Map<string, number>>(new Map());
  // Source of truth for startedAt reads inside the stable callbacks; state is
  // only the render mirror.
  const historyLoadStartedAtRef = useRef<Map<string, number>>(new Map());
  const hasContentRef = useRef(hasContent);
  hasContentRef.current = hasContent;

  const clearHistoryLoadFailed = useCallback((id: string) => {
    setHistoryLoadFailed((prev) => setFlag(prev, id, false));
  }, []);

  // Content-gated: a timeout / failure after content arrived is not a failure.
  // No content ⇒ the replay is dead too, so drop `replayInFlight` in the same
  // tick (avoids a frame where `loading` masks `failed`).
  const markHistoryLoadFailed = useCallback((id: string) => {
    if (hasContentRef.current(id)) return;
    setHistoryLoadFailed((prev) => setFlag(prev, id, true));
    clearLoadingHistory(setReplayInFlight, replayInFlightTimersRef, id);
  }, []);

  // Enter LOADING: set the flag and arm the short `SUBSCRIBE_ACK_MS` window
  // whose expiry marks the load failed. On the cold path the server's hydration
  // start marker re-arms it to `HYDRATE_CEILING_MS` (useMessageHandler).
  // startedAt is written when (a) nothing was armed, (b) `restart`, or (c) it
  // is missing — read BEFORE any setter so updaters stay pure.
  const beginLoadingHistory = useCallback((id: string, opts?: BeginLoadingHistoryOpts) => {
    const armed = loadingHistoryTimersRef.current.has(id) || replayInFlightTimersRef.current.has(id);
    if (!armed || opts?.restart || !historyLoadStartedAtRef.current.has(id)) {
      const next = new Map(historyLoadStartedAtRef.current);
      next.set(id, Date.now());
      historyLoadStartedAtRef.current = next;
      setHistoryLoadStartedAt(next);
    }
    clearHistoryLoadFailed(id);
    setLoadingHistory((prev) => {
      const next = new Map(prev);
      next.set(id, true);
      return next;
    });
    armLoadingHistoryTimer(setLoadingHistory, loadingHistoryTimersRef, id, SUBSCRIBE_ACK_MS, markHistoryLoadFailed);
  }, [clearHistoryLoadFailed, markHistoryLoadFailed]);

  // Sibling for the in-flight flag; its timer never marks failure.
  const beginReplayInFlight = useCallback((id: string) => {
    setReplayInFlight((prev) => {
      const next = new Map(prev);
      next.set(id, true);
      return next;
    });
    armLoadingHistoryTimer(setReplayInFlight, replayInFlightTimersRef, id, SUBSCRIBE_ACK_MS);
  }, []);

  // Drop every flag, timer, failed mark and clock. Used on reconnect and on a
  // server switch: a stale timer would otherwise fire a false failure.
  const resetAllHistoryLoad = useCallback(() => {
    clearTimers(loadingHistoryTimersRef);
    clearTimers(replayInFlightTimersRef);
    setLoadingHistory(new Map());
    setReplayInFlight(new Map());
    setHistoryLoadFailed(new Map());
    historyLoadStartedAtRef.current = new Map();
    setHistoryLoadStartedAt(historyLoadStartedAtRef.current);
  }, []);

  // Reconnect reset. A LAYOUT effect so it runs before App's arm-at-selection
  // layout effect in the same commit (which must re-arm the selected session
  // after this clear, not be wiped by it).
  const prevStatusRef = useRef(status);
  useLayoutEffect(() => {
    if (status === "connected" && prevStatusRef.current !== "connected") resetAllHistoryLoad();
    prevStatusRef.current = status;
  }, [status, resetAllHistoryLoad]);

  return {
    loadingHistory,
    setLoadingHistory,
    loadingHistoryTimersRef,
    replayInFlight,
    setReplayInFlight,
    replayInFlightTimersRef,
    historyLoadFailed,
    historyLoadStartedAt,
    beginLoadingHistory,
    beginReplayInFlight,
    markHistoryLoadFailed,
    clearHistoryLoadFailed,
    resetAllHistoryLoad,
  };
}
