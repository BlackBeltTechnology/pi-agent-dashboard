/**
 * GitProbeScheduler — two lanes, debounce, dirty bit, deferral.
 * test-plan ids: E25 E26 E27 E28. See change: optimize-polling-hot-paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitProbeScheduler, type ProbeOutcome } from "../git-probe-scheduler.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

function make(probe?: () => Promise<ProbeOutcome>) {
  const starts: number[] = [];
  const fn = vi.fn(async (info: { lane: string; reason: string }) => {
    starts.push(Date.now());
    return probe ? probe() : undefined;
  });
  const sched = createGitProbeScheduler({ probe: fn as any });
  return { sched, fn, starts };
}

describe("git probe scheduler", () => {
  it("debounces: a single request starts after 750 ms", async () => {
    const { sched, fn } = make();
    sched.request("fast", "watch");
    await vi.advanceTimersByTimeAsync(749);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
    sched.dispose();
  });

  it("E25: slow-lane request inside the 10 s window is deferred, not dropped", async () => {
    const { sched, starts } = make();
    sched.request("slow", "tick");
    await vi.advanceTimersByTimeAsync(750);
    expect(starts).toEqual([750]);
    await vi.advanceTimersByTimeAsync(8_250); // t = 9 s
    sched.request("slow", "tool");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts).toEqual([750, 10_750]);
    sched.dispose();
  });

  it("E26: tool end every 500 ms for 60 s → ≤ 6 slow probes", async () => {
    const { sched, fn } = make();
    for (let t = 0; t < 60_000; t += 500) {
      sched.request("slow", "tool");
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fn.mock.calls.length).toBeGreaterThan(0);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
    sched.dispose();
  });

  it("E27: pending slow + fast request → one fast-lane probe ≥ 2 s after the last fast one", async () => {
    const { sched, fn, starts } = make();
    sched.request("fast", "watch");
    await vi.advanceTimersByTimeAsync(750);
    expect(starts).toEqual([750]);
    await vi.advanceTimersByTimeAsync(250); // t = 1 s
    sched.request("slow", "tool");
    sched.request("fast", "watch");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn.mock.calls.map((c) => c[0].lane)).toEqual(["fast", "fast"]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2_000);
    sched.dispose();
  });

  it("E28: 3 requests during an in-flight probe → exactly one follow-up", async () => {
    let release!: () => void;
    let first = true;
    const { sched, fn } = make(() => {
      if (!first) return Promise.resolve();
      first = false;
      return new Promise<void>((r) => (release = r));
    });
    sched.request("fast", "watch");
    await vi.advanceTimersByTimeAsync(750);
    expect(fn).toHaveBeenCalledTimes(1);
    sched.request("fast", "watch");
    sched.request("slow", "tool");
    sched.request("fast", "refresh");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(1); // still in flight
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
    sched.dispose();
  });

  it("a probe resolving \"discard\" requests one more fast probe", async () => {
    let n = 0;
    const { sched, fn } = make(async () => (n++ === 0 ? "discard" : "ok"));
    sched.request("slow", "tick");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0].lane).toBe("fast");
    sched.dispose();
  });

  it("dispose clears the timer and a late settle re-arms nothing", async () => {
    let release!: () => void;
    const { sched, fn } = make(() => new Promise<void>((r) => (release = r)));
    sched.request("fast", "watch");
    await vi.advanceTimersByTimeAsync(750);
    sched.request("slow", "tool");
    sched.dispose();
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
