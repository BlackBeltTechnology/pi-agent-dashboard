/**
 * D4 v1 — open-inspector liveness. Stripping the push firehose removes what fed
 * a mounted inspector, so a mounted view must PULL: re-fire the existing
 * `subagent_resync_request` on a backoff cadence (C1: base 2 s, ×2 per idle
 * tick, 30 s ceiling, reset on entry growth) while the subagent runs.
 *
 * See change: reduce-subagent-details-payload.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CADENCE_BASE_MS,
  CADENCE_MAX_MS,
  useSubagentResyncCadence,
} from "../useSubagentResyncCadence.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSubagentResyncCadence", () => {
  it("fires nothing before the first interval elapses", () => {
    const onResync = vi.fn();
    renderHook(() =>
      useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync }),
    );
    vi.advanceTimersByTime(CADENCE_BASE_MS - 1);
    expect(onResync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  // F1 — the mounted view keeps pulling while the timeline grows, with NO
  // emptyTimeline precondition: that precondition is exactly why a mounted view
  // watching a growing timeline never re-fires today.
  it("F1: keeps firing for a NON-empty timeline (no emptyTimeline precondition)", () => {
    const onResync = vi.fn();
    const { rerender } = renderHook(
      ({ entryCount }) =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount, onResync }),
      { initialProps: { entryCount: 5 } },
    );

    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(1);

    // Growth resets the backoff, so the next tick is one base interval away.
    rerender({ entryCount: 12 });
    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(2);

    rerender({ entryCount: 30 });
    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(3);
  });

  // C1 — backoff while nothing arrives; reset on growth.
  it("C1: doubles the interval per idle tick, capped, and resets on entry growth", () => {
    const onResync = vi.fn();
    const { rerender } = renderHook(
      ({ entryCount }) =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount, onResync }),
      { initialProps: { entryCount: 5 } },
    );

    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(1);

    // Idle → next tick is 2x base, so one base interval is NOT enough.
    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(2);

    // Idle again → 4x base.
    vi.advanceTimersByTime(CADENCE_BASE_MS * 3);
    expect(onResync).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(3);

    // Growth resets to base.
    rerender({ entryCount: 6 });
    vi.advanceTimersByTime(CADENCE_BASE_MS);
    expect(onResync).toHaveBeenCalledTimes(4);
  });

  it("C1: never exceeds the 30 s ceiling", () => {
    const onResync = vi.fn();
    renderHook(() =>
      useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync }),
    );
    // Drive well past the point where doubling would exceed the ceiling.
    vi.advanceTimersByTime(CADENCE_MAX_MS * 20);
    const calls = onResync.mock.calls.length;
    // With the cap, a further N ceilings produce ~N more calls; without it the
    // interval would have run away and produced none.
    vi.advanceTimersByTime(CADENCE_MAX_MS * 3);
    expect(onResync.mock.calls.length).toBeGreaterThanOrEqual(calls + 3);
  });

  // F3 — lifecycle teardown.
  describe("F3: teardown", () => {
    it("emits zero further requests after unmount", () => {
      const onResync = vi.fn();
      const { unmount } = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync }),
      );
      vi.advanceTimersByTime(CADENCE_BASE_MS);
      expect(onResync).toHaveBeenCalledTimes(1);

      unmount();
      vi.advanceTimersByTime(CADENCE_MAX_MS * 10);
      expect(onResync).toHaveBeenCalledTimes(1);
    });

    it("stops when the subagent reaches a terminal status", () => {
      const onResync = vi.fn();
      const { rerender } = renderHook(
        ({ running }) =>
          useSubagentResyncCadence({ key: "s1:ag1", running, entryCount: 5, onResync }),
        { initialProps: { running: true } },
      );
      vi.advanceTimersByTime(CADENCE_BASE_MS);
      expect(onResync).toHaveBeenCalledTimes(1);

      rerender({ running: false });
      vi.advanceTimersByTime(CADENCE_MAX_MS * 10);
      expect(onResync).toHaveBeenCalledTimes(1);
    });

    it("never starts for a non-running subagent", () => {
      const onResync = vi.fn();
      renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: false, entryCount: 5, onResync }),
      );
      vi.advanceTimersByTime(CADENCE_MAX_MS * 10);
      expect(onResync).not.toHaveBeenCalled();
    });

    it("never starts without a key (no agentId / no session yet)", () => {
      const onResync = vi.fn();
      renderHook(() =>
        useSubagentResyncCadence({ key: undefined, running: true, entryCount: 5, onResync }),
      );
      vi.advanceTimersByTime(CADENCE_MAX_MS * 10);
      expect(onResync).not.toHaveBeenCalled();
    });
  });

  // F4 — the same subagent open in BOTH the inline inspector and the popout
  // route must not double-fire per cadence tick.
  describe("F4: no double-fire across simultaneous views", () => {
    it("fires once per tick with two mounted views of the same subagent", () => {
      const inline = vi.fn();
      const popout = vi.fn();
      const a = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync: inline }),
      );
      const b = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync: popout }),
      );

      // Two views mounted, one timer: exactly the tick count a SINGLE view
      // would have produced over the same window (base, then 2x base).
      vi.advanceTimersByTime(CADENCE_BASE_MS * 4);
      expect(inline.mock.calls.length + popout.mock.calls.length).toBe(2);
      expect(popout).not.toHaveBeenCalled();

      a.unmount();
      b.unmount();
    });

    it("hands ownership to the surviving view when the owner unmounts", () => {
      const inline = vi.fn();
      const popout = vi.fn();
      const a = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync: inline }),
      );
      const b = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync: popout }),
      );

      a.unmount();
      vi.advanceTimersByTime(CADENCE_BASE_MS);
      expect(popout).toHaveBeenCalledTimes(1);
      expect(inline).not.toHaveBeenCalled();

      b.unmount();
    });

    it("does not couple two DIFFERENT subagents", () => {
      const one = vi.fn();
      const two = vi.fn();
      const a = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag1", running: true, entryCount: 5, onResync: one }),
      );
      const b = renderHook(() =>
        useSubagentResyncCadence({ key: "s1:ag2", running: true, entryCount: 5, onResync: two }),
      );

      vi.advanceTimersByTime(CADENCE_BASE_MS);
      expect(one).toHaveBeenCalledTimes(1);
      expect(two).toHaveBeenCalledTimes(1);

      a.unmount();
      b.unmount();
    });
  });
});
