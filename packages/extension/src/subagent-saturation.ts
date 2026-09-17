/**
 * SubagentSaturation — the private resource-load sampler the subagent-fanout
 * admission gate reads.
 *
 * Why it exists rather than reusing `process-metrics.ts`: `collectMetrics()` is
 * a DESTRUCTIVE read — it resets the event-loop-delay histogram and the CPU
 * delta on every call — and its sole caller is the 15 s bridge heartbeat.
 * Reading it from admission would reset the window mid-interval, so the
 * heartbeat that recorded a 143 s stall would under-report exactly the failure
 * this capability mitigates. Merely reading the same histogram non-destructively
 * is also wrong: that histogram is reset every 15 s, so the gate would see a
 * window of 0–15 s depending on phase and flap the effective cap on the
 * telemetry period.
 *
 * The sampler therefore OWNS its state: a dedicated `monitorEventLoopDelay`
 * histogram over a fixed 5 s window (so a spike clears well inside one heartbeat)
 * plus its own CPU baseline. Hysteresis — enter at the threshold, leave below
 * 80 % of it — keeps consecutive decisions in one preflight batch agreeing.
 *
 * Domains differ and are stated: `process.cpuUsage()` observes this process
 * only; `os.loadavg()` observes the machine. The observed deaths are
 * machine-level saturation caused by many resident sessions, where a parent's
 * own CPU can read low — so the two are separate thresholds, never conflated.
 *
 * See change: bound-subagent-fanout-under-host-pressure (D5).
 */

import os from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { SubagentSaturationThresholds } from "@blackbelt-technology/pi-dashboard-shared/config.js";

/** Fixed rolling window (ms). Chosen so a spike clears inside one 15 s heartbeat. */
export const SATURATION_WINDOW_MS = 5_000;
/** Exit hysteresis: leave the narrowed state only below 80 % of the entry threshold. */
export const SATURATION_EXIT_RATIO = 0.8;
const ELD_RESOLUTION_MS = 20;

export type SaturationThresholds = SubagentSaturationThresholds;

/** One sample. A missing metric means "no signal", never "zero load". */
export interface SaturationReading {
  /** PROCESS domain. */
  eventLoopDelayMs?: number;
  /** PROCESS domain. */
  cpuPercent?: number;
  /** MACHINE domain. */
  loadAvg1m?: number;
}

export interface SaturationSnapshot {
  /** Post-hysteresis verdict the decision function consumes. */
  saturated: boolean;
  reading: SaturationReading;
}

/** True when `reading` is a usable number at/above `threshold * ratio`. */
function atOrAbove(reading: unknown, threshold: unknown, ratio: number): boolean {
  if (typeof reading !== "number" || !Number.isFinite(reading)) return false;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) return false;
  return reading >= threshold * ratio;
}

/** Any configured metric at/above `ratio` × its threshold. Missing metric → no signal. */
export function anyMetricAtOrAbove(
  reading: SaturationReading,
  thresholds: SaturationThresholds,
  ratio: number,
): boolean {
  return (
    atOrAbove(reading.eventLoopDelayMs, thresholds.eventLoopDelayMs, ratio) ||
    atOrAbove(reading.cpuPercent, thresholds.cpuPercent, ratio) ||
    atOrAbove(reading.loadAvg1m, thresholds.loadAvg1m, ratio)
  );
}

/**
 * Pure hysteresis transition. Enter the narrowed state at/above a threshold;
 * leave it only once EVERY metric has fallen below 80 % of its threshold.
 */
export function nextSaturationState(
  prev: boolean,
  reading: SaturationReading,
  thresholds: SaturationThresholds,
): boolean {
  if (anyMetricAtOrAbove(reading, thresholds, 1)) return true;
  if (!prev) return false;
  return anyMetricAtOrAbove(reading, thresholds, SATURATION_EXIT_RATIO);
}

export interface SaturationSamplerOptions {
  /** Rolling window override (tests). */
  windowMs?: number;
  /** Injectable clock. */
  now?: () => number;
  /** Injectable CPU source (process domain). */
  cpuUsage?: () => NodeJS.CpuUsage;
  /** Injectable machine load source. */
  loadAvg1m?: () => number;
  /**
   * Injectable event-loop-delay source (ms) — bypasses the owned histogram
   * entirely. Tests only; production omits it and owns a private histogram.
   */
  eventLoopDelayMs?: () => number | undefined;
}

/**
 * Owns a private rolling-window event-loop-delay histogram, a CPU baseline and
 * the post-hysteresis saturation latch. Never touches `process-metrics.ts`.
 */
export class SaturationSampler {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly cpuUsage: () => NodeJS.CpuUsage;
  private readonly loadAvg1m: () => number;
  private readonly injectedEld?: () => number | undefined;
  private readonly eld?: IntervalHistogram;
  private windowStart: number;
  private lastCpu?: NodeJS.CpuUsage;
  private lastCpuTime?: number;
  private saturated = false;

  constructor(opts: SaturationSamplerOptions = {}) {
    this.windowMs = opts.windowMs ?? SATURATION_WINDOW_MS;
    this.now = opts.now ?? Date.now;
    this.cpuUsage = opts.cpuUsage ?? (() => process.cpuUsage());
    this.loadAvg1m = opts.loadAvg1m ?? (() => os.loadavg()[0]);
    this.injectedEld = opts.eventLoopDelayMs;
    if (!opts.eventLoopDelayMs) {
      let histogram: IntervalHistogram | undefined;
      try {
        histogram = monitorEventLoopDelay({ resolution: ELD_RESOLUTION_MS });
        histogram.enable();
      } catch {
        histogram = undefined;
      }
      this.eld = histogram;
    }
    this.windowStart = this.now();
  }

  /** The current post-hysteresis verdict (last `read`'s saturated value). */
  get isSaturated(): boolean {
    return this.saturated;
  }

  /** Sample once and fold the reading through hysteresis. Synchronous by design. */
  read(thresholds: SaturationThresholds): SaturationSnapshot {
    const now = this.now();

    const cpuPercent = this.sampleCpu(now);
    const reading: SaturationReading = {
      eventLoopDelayMs: this.sampleEventLoopDelayMs(),
      cpuPercent,
      loadAvg1m: Math.round(this.loadAvg1m() * 100) / 100,
    };

    this.maybeRollWindow(now);
    this.saturated = nextSaturationState(this.saturated, reading, thresholds);
    return { saturated: this.saturated, reading };
  }

  /** Disable the owned histogram (bridge shutdown / test teardown). */
  dispose(): void {
    this.eld?.disable();
  }

  private sampleEventLoopDelayMs(): number | undefined {
    if (this.injectedEld) return this.injectedEld();
    if (!this.eld) return undefined;
    // `max` is nanoseconds since the last reset; the reset happens on window roll.
    return Math.round(this.eld.max / 1_000_000);
  }

  private sampleCpu(now: number): number | undefined {
    const cpu = this.cpuUsage();
    let cpuPercent: number | undefined;
    if (this.lastCpu && this.lastCpuTime !== undefined) {
      const elapsedMs = now - this.lastCpuTime;
      if (elapsedMs > 0) {
        const deltaMicros =
          cpu.user - this.lastCpu.user + (cpu.system - this.lastCpu.system);
        cpuPercent = Math.round((deltaMicros / (elapsedMs * 1000)) * 1000) / 10;
      }
    }
    this.lastCpu = cpu;
    this.lastCpuTime = now;
    return cpuPercent;
  }

  /** Roll the window once it has elapsed. Reset only in production (owned histogram). */
  private maybeRollWindow(now: number): void {
    if (now - this.windowStart < this.windowMs) return;
    this.windowStart = now;
    this.eld?.reset();
  }
}
