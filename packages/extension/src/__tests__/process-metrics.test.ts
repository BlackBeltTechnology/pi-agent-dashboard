import { describe, it, expect, afterEach } from "vitest";
import {
  resetGcCounters,
  collectMetrics,
  foldGcEntry,
  startMetricsMonitor,
  stopMetricsMonitor,
} from "../process-metrics.js";

describe("process-metrics", () => {
  afterEach(() => {
    stopMetricsMonitor();
  });

  it("collectMetrics returns valid shape without monitor", () => {
    const m = collectMetrics();
    expect(m.rss).toBeGreaterThan(0);
    expect(m.heapUsed).toBeGreaterThan(0);
    expect(m.heapTotal).toBeGreaterThan(0);
    expect(typeof m.cpuPercent).toBe("number");
    expect(typeof m.loadAvg1m).toBe("number");
    // eventLoopMaxMs is undefined without monitor
    expect(m.eventLoopMaxMs).toBeUndefined();
  });

  it("collectMetrics includes eventLoopMaxMs with monitor", async () => {
    startMetricsMonitor();
    // Let the event loop tick to capture some delay
    await new Promise((r) => setTimeout(r, 50));
    const m = collectMetrics();
    expect(typeof m.eventLoopMaxMs).toBe("number");
    expect(m.eventLoopMaxMs).toBeGreaterThanOrEqual(0);
  });

  it("cpuPercent computes delta on second call", () => {
    const first = collectMetrics();
    // Do some CPU work
    let x = 0;
    for (let i = 0; i < 1_000_000; i++) x += Math.sqrt(i);
    const second = collectMetrics();
    // Both should be numbers, second should show some cpu
    expect(typeof first.cpuPercent).toBe("number");
    expect(typeof second.cpuPercent).toBe("number");
    void x;
  });

  it("startMetricsMonitor is idempotent", () => {
    startMetricsMonitor();
    startMetricsMonitor(); // should not throw
    const m = collectMetrics();
    expect(m.rss).toBeGreaterThan(0);
  });
});

// ── Heap + GC telemetry (change: bound-session-heap-and-gc-telemetry) ──────
// `heapUsed` alone is unreadable without the ceiling it runs against, and a
// rising MAJOR count against a flat heap is the thrash signature that precedes
// an OOM. Tasks 9.2 / 9.3, test-plan #E17 / #E18.
describe("heap + GC telemetry", () => {
  afterEach(() => {
    stopMetricsMonitor();
  });

  it("reports the heap ceiling and the non-heap byte counters", () => {
    const m = collectMetrics();
    expect(m.heapSizeLimit).toBeGreaterThan(0);
    expect(m.heapSizeLimit).toBeGreaterThan(m.heapTotal);
    expect(typeof m.external).toBe("number");
    expect(typeof m.arrayBuffers).toBe("number");
  });

  it("counts every GC but only kind=4 as major (test-plan #E17)", () => {
    startMetricsMonitor();
    resetGcCounters();
    foldGcEntry({ duration: 1.5, detail: { kind: 1 } }); // minor
    foldGcEntry({ duration: 9.5, detail: { kind: 4 } }); // major
    foldGcEntry({ duration: 0.5 }); // no detail — must not throw
    const m = collectMetrics();
    expect(m.gcCount).toBe(3);
    expect(m.gcMajorCount).toBe(1);
    expect(m.gcPauseMsTotal).toBeCloseTo(11.5, 2);
  });

  it("classifies against detail.kind, never entry.kind", () => {
    startMetricsMonitor();
    resetGcCounters();
    // `entry.kind` is `undefined` on the supported runtime; an implementation
    // reading it would score this major entry as minor.
    foldGcEntry({ duration: 1, kind: 1, detail: { kind: 4 } } as never);
    expect(collectMetrics().gcMajorCount).toBe(1);
  });

  it("is read-and-reset, not cumulative (test-plan #E18)", () => {
    startMetricsMonitor();
    resetGcCounters();
    foldGcEntry({ duration: 2, detail: { kind: 4 } });
    expect(collectMetrics().gcCount).toBe(1);
    // A quiet interval reports zero, not the running total.
    const second = collectMetrics();
    expect(second.gcCount).toBe(0);
    expect(second.gcMajorCount).toBe(0);
    expect(second.gcPauseMsTotal).toBe(0);
  });

  it("omits the GC counters entirely when no observer is running", () => {
    stopMetricsMonitor();
    const m = collectMetrics();
    // ABSENT, not 0 — `0` would claim "no GC happened", which is a different
    // statement from "nobody was counting".
    expect(m.gcCount).toBeUndefined();
    expect(m.gcMajorCount).toBeUndefined();
  });
});
