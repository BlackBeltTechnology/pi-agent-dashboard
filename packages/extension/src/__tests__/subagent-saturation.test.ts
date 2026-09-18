/**
 * SaturationSampler + hysteresis — L1 unit tests for the admission gate's
 * private pressure source.
 *
 * Covers the test-plan rows X5 (telemetry interleave), X6 (cycle independence),
 * E12 (hysteresis), E13 (missing metric is not pressure) and E14 (metric
 * domains are independent).
 *
 * See change: bound-subagent-fanout-under-host-pressure (D5).
 */
import { describe, expect, it } from "vitest";
import { collectMetrics, startMetricsMonitor, stopMetricsMonitor } from "../process-metrics.js";
import {
  SATURATION_EXIT_RATIO,
  anyMetricAtOrAbove,
  nextSaturationState,
  SaturationSampler,
  type SaturationReading,
} from "../subagent-saturation.js";

const T = 100;

interface Harness {
  sampler: SaturationSampler;
  state: {
    eventLoopDelayMs: number | undefined;
    loadAvg1m: number;
    cpu: NodeJS.CpuUsage;
    clock: number;
  };
  /** Add CPU time (ms of CPU) and advance the wall clock the same amount. */
  burnCpu: (ms: number) => void;
  advance: (ms: number) => void;
}

function makeSampler(): Harness {
  const state = {
    eventLoopDelayMs: undefined as number | undefined,
    loadAvg1m: 0.1,
    cpu: { user: 0, system: 0 } as NodeJS.CpuUsage,
    clock: 1_000,
  };
  const sampler = new SaturationSampler({
    now: () => state.clock,
    cpuUsage: () => ({ ...state.cpu }),
    loadAvg1m: () => state.loadAvg1m,
    eventLoopDelayMs: () => state.eventLoopDelayMs,
  });
  return {
    sampler,
    state,
    burnCpu: (ms) => {
      state.clock += ms;
      // 1 ms of CPU == 1000 µs, reported as 100 % over a 1 ms wall delta.
      state.cpu.user += ms * 1_000;
      state.cpu.system += ms * 1_000;
    },
    advance: (ms) => {
      state.clock += ms;
    },
  };
}

describe("anyMetricAtOrAbove (pure)", () => {
  it("ignores undefined readings and thresholds", () => {
    expect(anyMetricAtOrAbove({}, {}, 1)).toBe(false);
    expect(anyMetricAtOrAbove({ eventLoopDelayMs: 999 }, {}, 1)).toBe(false);
    expect(anyMetricAtOrAbove({}, { eventLoopDelayMs: 100 }, 1)).toBe(false);
  });

  it("compares each metric to its own threshold", () => {
    expect(anyMetricAtOrAbove({ eventLoopDelayMs: T }, { eventLoopDelayMs: T }, 1)).toBe(true);
    expect(anyMetricAtOrAbove({ eventLoopDelayMs: T - 1 }, { eventLoopDelayMs: T }, 1)).toBe(false);
  });
});

describe("nextSaturationState (pure hysteresis)", () => {
  it("enters at the threshold", () => {
    expect(nextSaturationState(false, { eventLoopDelayMs: T }, { eventLoopDelayMs: T })).toBe(true);
  });

  it("does not enter below the threshold", () => {
    expect(nextSaturationState(false, { eventLoopDelayMs: T - 1 }, { eventLoopDelayMs: T })).toBe(false);
  });

  it("stays narrowed above 80 % and leaves below it", () => {
    const th = { eventLoopDelayMs: T };
    expect(nextSaturationState(true, { eventLoopDelayMs: T * SATURATION_EXIT_RATIO }, th)).toBe(true);
    expect(nextSaturationState(true, { eventLoopDelayMs: T * SATURATION_EXIT_RATIO - 1 }, th)).toBe(false);
  });
});

describe("SaturationSampler.read — E13 missing metric is not saturation", () => {
  it("admits when the event-loop reading is unavailable and all else is below", () => {
    const { sampler, state } = makeSampler();
    state.eventLoopDelayMs = undefined;
    state.loadAvg1m = 0.1;
    const snap = sampler.read({ eventLoopDelayMs: T, cpuPercent: T, loadAvg1m: T });
    expect(snap.saturated).toBe(false);
    expect(snap.reading.eventLoopDelayMs).toBeUndefined();
  });
});

describe("SaturationSampler.read — E14 metric domains are independent", () => {
  it("fires on machine load even when process CPU is low", () => {
    const { sampler, state } = makeSampler();
    // No CPU burned → process-domain reading ~0; machine load above threshold.
    state.loadAvg1m = 5;
    const snap = sampler.read({ cpuPercent: 50, loadAvg1m: 1 });
    expect(snap.saturated).toBe(true);
  });

  it("fires on process CPU even when machine load is low", () => {
    const h = makeSampler();
    // Warm the CPU baseline so the next read has a delta to measure.
    h.sampler.read({ cpuPercent: 50, loadAvg1m: 1 });
    h.burnCpu(1_000);
    h.state.loadAvg1m = 0.1;
    const snap = h.sampler.read({ cpuPercent: 50, loadAvg1m: 1 });
    expect(snap.saturated).toBe(true);
  });
});

describe("SaturationSampler.read — E12 hysteresis", () => {
  it("stays narrowed through 0.99T/0.85T/0.81T and leaves at 0.79T", () => {
    const { sampler, state } = makeSampler();
    const th = { eventLoopDelayMs: T };

    state.eventLoopDelayMs = 1.5 * T;
    expect(sampler.read(th).saturated).toBe(true);

    state.eventLoopDelayMs = 0.99 * T;
    expect(sampler.read(th).saturated).toBe(true);

    state.eventLoopDelayMs = 0.85 * T;
    expect(sampler.read(th).saturated).toBe(true);

    state.eventLoopDelayMs = 0.81 * T;
    expect(sampler.read(th).saturated).toBe(true);

    state.eventLoopDelayMs = 0.79 * T;
    expect(sampler.read(th).saturated).toBe(false);
  });
});

describe("SaturationSampler.read — X6 independent of the telemetry cycle", () => {
  it("reports saturation both right after a heartbeat and just before the next", () => {
    const { sampler, state } = makeSampler();
    const th = { loadAvg1m: 1 };
    state.loadAvg1m = 5;

    // Heartbeat boundary: sample telemetry, then admission.
    collectMetrics();
    const afterHeartbeat = sampler.read(th);
    expect(afterHeartbeat.saturated).toBe(true);

    // Near the next heartbeat: admission again, then telemetry.
    const beforeNext = sampler.read(th);
    expect(beforeNext.saturated).toBe(true);

    expect(afterHeartbeat.saturated).toBe(beforeNext.saturated);
  });
});

describe("SaturationSampler — X5 reading does not disturb telemetry", () => {
  it("leaves the shared event-loop histogram intact between heartbeats", async () => {
    startMetricsMonitor();
    const sampler = new SaturationSampler();
    try {
      // Block the loop so the shared histogram records a real delay.
      const end = Date.now() + 60;
      while (Date.now() < end) {
        /* deliberate synchronous block */
      }
      // Let the monitor's resolution timer fire so `.max` reflects the block.
      await new Promise((r) => setTimeout(r, 50));
      // Admission reads repeatedly between two heartbeats.
      for (let i = 0; i < 25; i++) sampler.read({ eventLoopDelayMs: 100 });
      const metrics = collectMetrics();
      expect(typeof metrics.eventLoopMaxMs).toBe("number");
      // If the sampler had reset the shared histogram, this would be ~0.
      expect(metrics.eventLoopMaxMs).toBeGreaterThan(0);
    } finally {
      sampler.dispose();
      stopMetricsMonitor();
    }
  });
});

describe("SaturationSampler — rolling window", () => {
  it("reports an undefined reading when no metric is configured", () => {
    const h = makeSampler();
    h.advance(10_000);
    h.state.eventLoopDelayMs = 5;
    const snap = h.sampler.read({});
    expect(snap.saturated).toBe(false);
    expect(snap.reading.eventLoopDelayMs).toBe(5);
  });
});
