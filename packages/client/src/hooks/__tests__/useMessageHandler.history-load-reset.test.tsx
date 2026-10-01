/**
 * Reconnect + server-switch resets of the history-load bookkeeping.
 * See change: show-session-history-load-state (test-plan #F1, #F2).
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBSCRIBE_ACK_MS } from "../../lib/replay/loading-history.js";
import { setupHistoryLoad } from "../../test-support/history-load-harness.js";

describe("history-load reset", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function allEmpty(hl: ReturnType<ReturnType<typeof setupHistoryLoad>["cur"]>["hl"], id: string) {
    expect(hl.loadingHistory.get(id)).toBeFalsy();
    expect(hl.replayInFlight.get(id)).toBeFalsy();
    expect(hl.historyLoadFailed.get(id)).toBeFalsy();
    expect(hl.historyLoadStartedAt.has(id)).toBe(false);
  }

  it("#F1 reconnect clears flags, timers, failed and startedAt for every session", () => {
    const h = setupHistoryLoad("connected");
    // B fails first, then both A and B are loading with armed timers.
    h.begin("B");
    h.advance(SUBSCRIBE_ACK_MS);
    expect(h.cur().hl.historyLoadFailed.get("B")).toBe(true);
    h.begin("A");
    act(() => h.cur().hl.beginReplayInFlight("B"));
    act(() => h.cur().hl.beginLoadingHistory("B"));
    act(() => h.cur().hl.markHistoryLoadFailed("B"));
    expect(h.cur().hl.historyLoadFailed.get("B")).toBe(true);
    h.markSpy.mockClear();

    h.setStatus("disconnected");
    h.setStatus("connected");
    allEmpty(h.cur().hl, "A");
    allEmpty(h.cur().hl, "B");
    expect(h.cur().hl.loadingHistoryTimersRef.current.size).toBe(0);
    expect(h.cur().hl.replayInFlightTimersRef.current.size).toBe(0);

    h.advance(20_000);
    expect(h.markSpy).not.toHaveBeenCalled();
    expect(h.cur().hl.historyLoadFailed.get("B")).toBeFalsy();
    expect(h.phase("B", false)).toBe("idle");
  });

  it("#F2 server switch (resetAllHistoryLoad) empties all four maps; timer never runs", () => {
    const h = setupHistoryLoad();
    h.begin("S");
    act(() => h.cur().hl.markHistoryLoadFailed("S"));
    h.begin("S");
    act(() => h.cur().hl.markHistoryLoadFailed("S"));
    expect(h.cur().hl.historyLoadFailed.get("S")).toBe(true);
    h.markSpy.mockClear();
    act(() => h.cur().hl.resetAllHistoryLoad());
    expect(h.cur().hl.loadingHistory.size).toBe(0);
    expect(h.cur().hl.replayInFlight.size).toBe(0);
    expect(h.cur().hl.historyLoadFailed.size).toBe(0);
    expect(h.cur().hl.historyLoadStartedAt.size).toBe(0);
    h.advance(100_000);
    expect(h.markSpy).not.toHaveBeenCalled();
    expect(h.cur().hl.historyLoadFailed.size).toBe(0);
  });
});
