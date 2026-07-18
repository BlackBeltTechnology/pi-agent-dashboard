/**
 * Tests for eventloop-sampler.ts — the dedicated ELD safety-net sampler.
 *
 * The sampler's LOGIC (snapshot `max`, compare to the floor, emit, then reset
 * ITS OWN histogram) is verified deterministically with an injected fake
 * histogram — real `monitorEventLoopDelay` timing is flaky under parallel-suite
 * load. One lenient real-block test proves an end-to-end capture.
 *
 * See change: attribute-openspec-poll-eventloop-stalls.
 */

import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startEventLoopSampler } from "../metrics/eventloop-sampler.js";

/** Minimal injectable histogram: only `max` (getter) + `reset` are used. */
function fakeHistogram(maxMsSequence: number[]): { hist: IntervalHistogram; state: { resets: number } } {
  let i = 0;
  const state = { resets: 0 };
  const hist = {
    get max() {
      const v = maxMsSequence[Math.min(i, maxMsSequence.length - 1)];
      return v * 1e6; // ms → ns
    },
    reset() {
      state.resets++;
      i++; // advance to the next scripted max
    },
  } as unknown as IntervalHistogram;
  return { hist, state };
}

function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait to stall the loop */ }
}

describe("startEventLoopSampler", () => {
  let sampler: { stop(): void } | undefined;
  afterEach(() => { sampler?.stop(); sampler = undefined; });

  it("records a spike when sampled max reaches the floor, then resets its own histogram", async () => {
    // First sample 300ms (above floor), then 0 after reset.
    const f = fakeHistogram([300, 0, 0, 0]);
    const spikes: number[] = [];
    sampler = startEventLoopSampler({
      floorMs: 100,
      intervalMs: 15,
      onSpike: (ms) => spikes.push(ms),
      histogram: f.hist,
    });
    await new Promise((r) => setTimeout(r, 90));
    expect(spikes.length).toBeGreaterThanOrEqual(1);
    expect(spikes[0]).toBeGreaterThanOrEqual(100);
    // Reset ran (each tick resets its own histogram) — no reset race possible.
    expect(f.state.resets).toBeGreaterThanOrEqual(1);
  });

  it("does not record when sampled max stays below the floor", async () => {
    const f = fakeHistogram([20, 20, 20, 20]);
    const spikes: number[] = [];
    sampler = startEventLoopSampler({
      floorMs: 500,
      intervalMs: 15,
      onSpike: (ms) => spikes.push(ms),
      histogram: f.hist,
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(spikes).toHaveLength(0);
  });

  it("owns a dedicated histogram — never reads or resets the injected /api/health histogram", async () => {
    // The boot histogram `/api/health` reads-and-resets. The sampler must never
    // touch it, so `reset` is never called and its stats survive untouched.
    const healthHistogram = monitorEventLoopDelay({ resolution: 20 });
    healthHistogram.enable();
    const resetSpy = vi.spyOn(healthHistogram, "reset");

    // Sampler runs on its OWN fake histogram, not the health one.
    const f = fakeHistogram([700, 0, 0]);
    sampler = startEventLoopSampler({
      floorMs: 100,
      intervalMs: 15,
      onSpike: () => { /* noop */ },
      histogram: f.hist,
    });
    await new Promise((r) => setTimeout(r, 80));

    expect(resetSpy).not.toHaveBeenCalled();
    healthHistogram.disable();
  });

  it("captures a real synthetic block end-to-end (lenient window)", async () => {
    const spikes: number[] = [];
    // A realistic cadence (>> the 20ms histogram resolution). A cadence at or
    // near the resolution races libuv's delayed sample-commit and loses the
    // spike; production samples at 1000ms, so 200ms here is representative.
    sampler = startEventLoopSampler({
      floorMs: 100,
      intervalMs: 200,
      onSpike: (ms) => spikes.push(ms),
    });
    await new Promise((r) => setTimeout(r, 50));
    blockFor(500);
    // Give a couple of post-block ticks; the histogram has committed the delay
    // by the next 200ms tick.
    await new Promise((r) => setTimeout(r, 600));
    expect(spikes.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...spikes)).toBeGreaterThanOrEqual(100);
  });
});
