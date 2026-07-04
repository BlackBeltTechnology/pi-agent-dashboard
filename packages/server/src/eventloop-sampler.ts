/**
 * Dedicated event-loop-delay sampler — the safety-net feed for the
 * event-loop spike buffer (`eventloop-spike-metrics.ts`).
 *
 * Owns its OWN `monitorEventLoopDelay` histogram — NEVER the boot histogram
 * `/api/health` reads-and-resets. On a fixed cadence it snapshots `max`, and
 * when `max` is at or above the floor it emits `onSpike(maxMs)` (recorded with
 * a `null` turn label), then `reset()`s its own histogram. Because it never
 * touches the `/api/health` histogram there is no reset race: `/api/health`'s
 * mean/p99/max stay unaffected.
 *
 * This captures stalls no instrumented poll turn owns (GC, session-hydration
 * deserialize, WS on-connect) even when nobody is polling `/api/health` at the
 * instant the block occurs. Measurement failures never propagate.
 *
 * See change: attribute-openspec-poll-eventloop-stalls.
 */
import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks";

export interface EventLoopSampler {
  stop(): void;
}

export interface EventLoopSamplerOptions {
  /** Record a spike when the sampled `max` is >= this (ms). */
  floorMs: number;
  /** Snapshot cadence (ms). */
  intervalMs: number;
  /** Invoked with the above-floor `max` (ms) on each qualifying sample. */
  onSpike: (ms: number) => void;
  /**
   * Injectable histogram for tests. When omitted a fresh dedicated
   * `monitorEventLoopDelay` instance is created and enabled.
   */
  histogram?: IntervalHistogram;
}

export function startEventLoopSampler(opts: EventLoopSamplerOptions): EventLoopSampler {
  const ownsHistogram = opts.histogram === undefined;
  const histogram = opts.histogram ?? monitorEventLoopDelay({ resolution: 20 });
  if (ownsHistogram) histogram.enable();

  const tick = () => {
    try {
      const maxMs = histogram.max / 1e6;
      if (Number.isFinite(maxMs) && maxMs >= opts.floorMs) {
        opts.onSpike(maxMs);
      }
      histogram.reset();
    } catch {
      // Measurement must never take down the process.
    }
  };

  const timer = setInterval(tick, opts.intervalMs);
  // Don't keep the process alive for a diagnostic sampler.
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
      if (ownsHistogram) {
        try { histogram.disable(); } catch { /* ignore */ }
      }
    },
  };
}
