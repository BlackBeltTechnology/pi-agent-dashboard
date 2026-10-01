/**
 * `onTimeout` hook on the loading-history timer paths. Only a TIMER-driven
 * clear invokes it; a direct `clearLoadingHistory` (content / terminal edge)
 * never does. See change: show-session-history-load-state (task 2.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armLoadingHistoryTimer, clearLoadingHistory, HYDRATE_CEILING_MS, rearmLoadingHistory, SUBSCRIBE_ACK_MS } from "../loading-history.js";

function setup() {
  const flag = { current: new Map<string, boolean>([["s", true]]) };
  const setFlag = vi.fn((u: any) => {
    flag.current = typeof u === "function" ? u(flag.current) : u;
  });
  const timersRef = { current: new Map<string, ReturnType<typeof setTimeout>>() };
  return { flag, setFlag, timersRef };
}

describe("loading-history onTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("armLoadingHistoryTimer: timer expiry clears the flag then calls onTimeout", () => {
    const { flag, setFlag, timersRef } = setup();
    const onTimeout = vi.fn();
    armLoadingHistoryTimer(setFlag, timersRef, "s", SUBSCRIBE_ACK_MS, onTimeout);
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flag.current.get("s")).toBe(false);
    expect(onTimeout).toHaveBeenCalledWith("s");
    expect(timersRef.current.has("s")).toBe(false);
  });

  it("rearmLoadingHistory: re-armed timer forwards onTimeout", () => {
    const { setFlag, timersRef } = setup();
    const onTimeout = vi.fn();
    armLoadingHistoryTimer(setFlag, timersRef, "s", SUBSCRIBE_ACK_MS, onTimeout);
    rearmLoadingHistory(setFlag, timersRef, "s", HYDRATE_CEILING_MS, onTimeout);
    vi.advanceTimersByTime(SUBSCRIBE_ACK_MS);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HYDRATE_CEILING_MS - SUBSCRIBE_ACK_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("rearmLoadingHistory without onTimeout never calls the original one", () => {
    const { setFlag, timersRef } = setup();
    const onTimeout = vi.fn();
    armLoadingHistoryTimer(setFlag, timersRef, "s", SUBSCRIBE_ACK_MS, onTimeout);
    rearmLoadingHistory(setFlag, timersRef, "s", HYDRATE_CEILING_MS);
    vi.advanceTimersByTime(HYDRATE_CEILING_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("clearLoadingHistory (content / terminal edge) never invokes onTimeout", () => {
    const { flag, setFlag, timersRef } = setup();
    const onTimeout = vi.fn();
    armLoadingHistoryTimer(setFlag, timersRef, "s", SUBSCRIBE_ACK_MS, onTimeout);
    clearLoadingHistory(setFlag, timersRef, "s");
    vi.advanceTimersByTime(HYDRATE_CEILING_MS);
    expect(flag.current.get("s")).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
