/**
 * Host-pressure tracker — transition-only pressure verdicts.
 * See change: fix-false-unresponsive-badge.
 *
 * The browser cannot observe bridge silence on its own: `processMetrics` is
 * pushed once in `sessions_snapshot` and never refreshed, so a client deriving
 * silence from it reads every live session as unresponsive a minute after page
 * load. The server owns the last-frame fact, so it derives the verdict and
 * emits ONLY on a state transition.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostPressureTracker,
  HOST_PRESSURE_DEGRADED_MS,
  HOST_PRESSURE_UNRESPONSIVE_MS,
  type HostPressure,
} from "../host-pressure-tracker.js";

type Emission = { sessionId: string; pressure: HostPressure | null };

function setup() {
  const emissions: Emission[] = [];
  const tracker = createHostPressureTracker({
    onChange: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
  });
  return { emissions, tracker };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("host-pressure tracker", () => {
  it("a fresh frame emits nothing — a healthy session costs zero frames", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1);
    expect(emissions).toEqual([]);
  });

  it("crossing the degraded threshold emits degraded once, stamped with the last frame time", () => {
    const { emissions, tracker } = setup();
    const at = Date.now();
    tracker.noteFrame("s1");

    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS);
    expect(emissions).toEqual([{ sessionId: "s1", pressure: { state: "degraded", since: at } }]);

    // No further emission until the next threshold.
    vi.advanceTimersByTime(1_000);
    expect(emissions).toHaveLength(1);
  });

  it("continued silence escalates to unresponsive exactly once", () => {
    const { emissions, tracker } = setup();
    const at = Date.now();
    tracker.noteFrame("s1");

    vi.advanceTimersByTime(HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions.map((e) => e.pressure?.state)).toEqual(["degraded", "unresponsive"]);
    expect(emissions[1]?.pressure).toEqual({ state: "unresponsive", since: at });

    vi.advanceTimersByTime(10 * HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions).toHaveLength(2);
  });

  it("a frame after pressure clears it with an explicit null", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS);
    emissions.length = 0;

    tracker.noteFrame("s1");
    expect(emissions).toEqual([{ sessionId: "s1", pressure: null }]);

    // Back to healthy: no repeat clear on the next frame.
    tracker.noteFrame("s1");
    expect(emissions).toHaveLength(1);
  });

  it("clear() drops the session without emitting — an ended card has no pressure", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    tracker.clear("s1");
    vi.advanceTimersByTime(10 * HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions).toEqual([]);
  });

  it("tracks sessions independently", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1_000);
    tracker.noteFrame("s2");

    vi.advanceTimersByTime(1_000);
    expect(emissions.map((e) => e.sessionId)).toEqual(["s1"]);

    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1_000);
    expect(emissions.map((e) => e.sessionId)).toEqual(["s1", "s1", "s2"]);
  });

  it("stop() cancels every pending timer", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    tracker.noteFrame("s2");
    tracker.stop();
    vi.advanceTimersByTime(10 * HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions).toEqual([]);
  });
});
