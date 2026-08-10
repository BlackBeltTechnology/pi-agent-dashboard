/**
 * Tests for hydration-metrics.ts ring buffer.
 * See change: instrument-session-hydration-timing.
 */
import { describe, it, expect } from "vitest";
import { createHydrationMetrics, type HydrationSample } from "../metrics/hydration-metrics.js";

function makeSample(overrides: Partial<HydrationSample> = {}): HydrationSample {
  return {
    sessionId: "s1",
    wallMs: 1,
    fileBytes: 100,
    entryCount: 10,
    eventCount: 20,
    at: Date.now(),
    ...overrides,
  };
}

describe("createHydrationMetrics", () => {
  it("snapshot() is empty before any record", () => {
    const m = createHydrationMetrics(3);
    expect(m.snapshot()).toEqual([]);
  });

  it("records samples and returns them newest-first", () => {
    const m = createHydrationMetrics(5);
    m.record(makeSample({ sessionId: "a" }));
    m.record(makeSample({ sessionId: "b" }));
    m.record(makeSample({ sessionId: "c" }));
    expect(m.snapshot().map((s) => s.sessionId)).toEqual(["c", "b", "a"]);
  });

  it("caps at capacity, dropping oldest on overflow", () => {
    const m = createHydrationMetrics(2);
    m.record(makeSample({ sessionId: "a" }));
    m.record(makeSample({ sessionId: "b" }));
    m.record(makeSample({ sessionId: "c" }));
    const snap = m.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map((s) => s.sessionId)).toEqual(["c", "b"]);
  });

  it("non-finite capacity falls back to 1 (stays bounded)", () => {
    const m = createHydrationMetrics(NaN);
    m.record(makeSample({ sessionId: "a" }));
    m.record(makeSample({ sessionId: "b" }));
    const snap = m.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].sessionId).toBe("b");
  });

  it("snapshot() returns copies, not internal references", () => {
    const m = createHydrationMetrics(2);
    m.record(makeSample({ sessionId: "a" }));
    const first = m.snapshot();
    m.record(makeSample({ sessionId: "b" }));
    // Mutating an earlier snapshot must not affect later snapshots.
    expect(first).toHaveLength(1);
    expect(m.snapshot()).toHaveLength(2);
  });
});
