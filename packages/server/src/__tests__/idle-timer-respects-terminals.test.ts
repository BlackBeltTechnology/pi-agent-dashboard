import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIdleTimer } from "../idle-timer.js";
import type { PiGateway } from "../pi-gateway.js";
import type { ServerConfig } from "../server.js";

// See change: fix-terminal-half-height-dual-mount.
// Pure unit tests against the idle-timer's predicate-driven gating.
// Avoids the full-server I/O races that have the auto-shutdown.test.ts
// suite skipped under fake timers.

function makeConfig(): ServerConfig {
  return {
    port: 0,
    piPort: 0,
    dev: true,
    autoShutdown: true,
    shutdownIdleSeconds: 2,
    tunnel: false,
    pingInterval: 0,
  } as ServerConfig;
}

function makeGateway(connectionCount = 0): PiGateway {
  return {
    connectionCount: () => connectionCount,
    onEmpty: undefined,
    onConnection: undefined,
  } as unknown as PiGateway;
}

describe("idle-timer respects active terminals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT shut down when one or more terminals are alive", async () => {
    const gateway = makeGateway(0);
    let terminalCount = 1;
    const timer = createIdleTimer(makeConfig(), gateway, () => terminalCount > 0);
    const stopFn = vi.fn().mockResolvedValue(undefined);
    timer.setStopFn(stopFn);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    timer.start();
    // Advance well past shutdownIdleSeconds.
    await vi.advanceTimersByTimeAsync(3000);

    expect(stopFn).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    timer.cancel();
  });

  it("shuts down when no pi sessions AND no terminals are alive", async () => {
    const gateway = makeGateway(0);
    const timer = createIdleTimer(makeConfig(), gateway, () => false);
    const stopFn = vi.fn().mockResolvedValue(undefined);
    timer.setStopFn(stopFn);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    timer.start();
    // First tick: realIdleMs is 0 because lastConnectionTimestamp = 0.
    // The implementation guards on realIdleMs < shutdownIdleSeconds*1000
    // and restarts; so we need two ticks separated by enough wall time.
    await vi.advanceTimersByTimeAsync(2000);
    // After the first tick the timer has restarted; advance again.
    await vi.advanceTimersByTimeAsync(2000);

    expect(stopFn).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it("re-arms (does not shut down) when terminals appear mid-countdown", async () => {
    const gateway = makeGateway(0);
    let terminalCount = 0;
    const timer = createIdleTimer(makeConfig(), gateway, () => terminalCount > 0);
    const stopFn = vi.fn().mockResolvedValue(undefined);
    timer.setStopFn(stopFn);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    timer.start();
    // Just before the timer fires, a terminal appears.
    await vi.advanceTimersByTimeAsync(1500);
    terminalCount = 1;
    // Let it fire.
    await vi.advanceTimersByTimeAsync(1500);

    expect(stopFn).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    timer.cancel();
  });

  it("default predicate (no terminals) preserves legacy single-arg call site behavior", async () => {
    // Caller may construct without the third arg; default is () => false.
    const gateway = makeGateway(0);
    const timer = createIdleTimer(makeConfig(), gateway);
    const stopFn = vi.fn().mockResolvedValue(undefined);
    timer.setStopFn(stopFn);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    timer.start();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(stopFn).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
