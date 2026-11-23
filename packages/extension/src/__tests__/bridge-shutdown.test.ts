/**
 * `runBridgeShutdown` — the bridge's session-shutdown path with its hard-exit
 * fallback. Drives the REAL module with injected `exit` / `setTimer` seams.
 *
 * pi 1.5.1+ exits on its own when `ctx.shutdown()` is called while idle, and its
 * `dispose()` waits for an in-progress credential write, so the bridge's
 * fallback must leave it time (5 s, was 500 ms) and must not hold the loop.
 *
 * See change: update-pi-core-1-6-adopt-apis (test-plan #E9, #E10, #X1, #X2;
 * spec bridge-extension: "Bridge session shutdown leaves pi time for a clean exit").
 */
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SHUTDOWN_FALLBACK_MS, runBridgeShutdown } from "../bridge-shutdown.js";

/** A manual clock: `setTimer` records one callback, `advance` fires it when due. */
function fakeTimers() {
  const unref = vi.fn();
  let pending: { fn: () => void; at: number } | null = null;
  let now = 0;
  const setTimer = vi.fn((fn: () => void, ms: number) => {
    pending = { fn, at: now + ms };
    return { unref };
  });
  const advance = (ms: number) => {
    now += ms;
    if (pending && now >= pending.at) {
      const { fn } = pending;
      pending = null;
      fn();
    }
  };
  return { setTimer, advance, unref };
}

describe("runBridgeShutdown", () => {
  it("the fallback is 5000 ms", () => {
    expect(BRIDGE_SHUTDOWN_FALLBACK_MS).toBe(5000);
  });

  // #E9
  it("E9: ctx.shutdown once at t=0; no exit at 4999 ms; exit(0) once at 5000 ms", () => {
    const t = fakeTimers();
    const exit = vi.fn();
    const shutdown = vi.fn();
    runBridgeShutdown({ shutdown }, { exit, setTimer: t.setTimer });
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    t.advance(4999);
    expect(exit).not.toHaveBeenCalled();
    t.advance(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  // #E10
  it("E10: the fallback timer handle is unref'd exactly once", () => {
    const t = fakeTimers();
    runBridgeShutdown({ shutdown: vi.fn() }, { exit: vi.fn(), setTimer: t.setTimer });
    expect(t.setTimer).toHaveBeenCalledTimes(1);
    expect(t.setTimer.mock.calls[0][1]).toBe(BRIDGE_SHUTDOWN_FALLBACK_MS);
    expect(t.unref).toHaveBeenCalledTimes(1);
  });

  // #X1
  it("X1: a ctx without shutdown (or no ctx) still arms the fallback and does not throw", () => {
    for (const ctx of [{}, undefined, null]) {
      const t = fakeTimers();
      const exit = vi.fn();
      expect(() => runBridgeShutdown(ctx, { exit, setTimer: t.setTimer })).not.toThrow();
      t.advance(BRIDGE_SHUTDOWN_FALLBACK_MS);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    }
  });

  // #X2
  it("X2: a throwing ctx.shutdown does not escape and the fallback still fires", () => {
    const t = fakeTimers();
    const exit = vi.fn();
    const shutdown = vi.fn(() => {
      throw new Error("stale ctx");
    });
    expect(() => runBridgeShutdown({ shutdown }, { exit, setTimer: t.setTimer })).not.toThrow();
    expect(shutdown).toHaveBeenCalledTimes(1);
    t.advance(4999);
    expect(exit).not.toHaveBeenCalled();
    t.advance(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("works with the real timer + process.exit defaults without exiting early", () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      runBridgeShutdown({ shutdown: vi.fn() });
      vi.advanceTimersByTime(4999);
      expect(exitSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
