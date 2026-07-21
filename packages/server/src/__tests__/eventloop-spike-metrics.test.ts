/**
 * Tests for eventloop-spike-metrics.ts ring buffer.
 * See change: attribute-openspec-poll-eventloop-stalls.
 */
import { describe, expect, it } from "vitest";
import { createEventLoopSpikeMetrics, type EventLoopSpike } from "../metrics/eventloop-spike-metrics.js";

function makeSpike(overrides: Partial<EventLoopSpike> = {}): EventLoopSpike {
  return { at: Date.now(), ms: 700, turn: null, ...overrides };
}

describe("createEventLoopSpikeMetrics", () => {
  it("snapshot() is empty before any record", () => {
    const m = createEventLoopSpikeMetrics(3);
    expect(m.snapshot()).toEqual([]);
  });

  it("records spikes and returns them newest-first", () => {
    const m = createEventLoopSpikeMetrics(5);
    m.record(makeSpike({ ms: 1, turn: "tickOpen" }));
    m.record(makeSpike({ ms: 2, turn: "dirPollPre" }));
    m.record(makeSpike({ ms: 3, turn: null }));
    expect(m.snapshot().map((s) => s.ms)).toEqual([3, 2, 1]);
  });

  it("caps at capacity, evicting oldest on overflow", () => {
    const m = createEventLoopSpikeMetrics(2);
    m.record(makeSpike({ ms: 1 }));
    m.record(makeSpike({ ms: 2 }));
    m.record(makeSpike({ ms: 3 }));
    const snap = m.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map((s) => s.ms)).toEqual([3, 2]);
  });

  it("non-finite capacity falls back to 1 (stays bounded)", () => {
    const m = createEventLoopSpikeMetrics(NaN);
    m.record(makeSpike({ ms: 1 }));
    m.record(makeSpike({ ms: 2 }));
    const snap = m.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].ms).toBe(2);
  });

  it("retains the attributed turn label verbatim", () => {
    const m = createEventLoopSpikeMetrics(3);
    m.record(makeSpike({ turn: "dirPollPost" }));
    m.record(makeSpike({ turn: null }));
    expect(m.snapshot().map((s) => s.turn)).toEqual([null, "dirPollPost"]);
  });

  it("snapshot() returns copies, not internal references", () => {
    const m = createEventLoopSpikeMetrics(2);
    m.record(makeSpike({ ms: 1 }));
    const first = m.snapshot();
    m.record(makeSpike({ ms: 2 }));
    expect(first).toHaveLength(1);
    expect(m.snapshot()).toHaveLength(2);
  });
});
