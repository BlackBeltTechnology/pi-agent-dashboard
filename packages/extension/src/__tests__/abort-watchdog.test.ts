import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AbortWatchdog } from "../abort-watchdog.js";

const child = (pgid: number) => ({ pid: pgid + 1, pgid, command: "sleep 600", elapsedMs: 12_000 });

describe("AbortWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after delay only when latch is active and agent is streaming", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      killGraceMs: 2_000,
      isLatchActive: () => true,
      isStreaming: () => true,
      scanChildren: () => [child(200)],
      killGroup,
    });

    wd.arm("s1");
    vi.advanceTimersByTime(9_999);
    expect(killGroup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(killGroup).toHaveBeenCalledWith(200, "SIGTERM");
  });

  it("does nothing when latch cleared before timer fires", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      isLatchActive: () => false,
      isStreaming: () => true,
      scanChildren: () => [child(200)],
      killGroup,
    });

    wd.arm("s1");
    vi.advanceTimersByTime(10_000);
    expect(killGroup).not.toHaveBeenCalled();
  });

  it("does nothing when agent stopped streaming before timer fires", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      isLatchActive: () => true,
      isStreaming: () => false,
      scanChildren: () => [child(200)],
      killGroup,
    });

    wd.arm("s1");
    vi.advanceTimersByTime(10_000);
    expect(killGroup).not.toHaveBeenCalled();
  });

  it("SIGKILLs surviving children after grace", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      killGraceMs: 2_000,
      isLatchActive: () => true,
      isStreaming: () => true,
      scanChildren: () => [child(200), child(201)],
      killGroup,
    });

    wd.arm("s1");
    vi.advanceTimersByTime(10_000);
    expect(killGroup).toHaveBeenCalledWith(200, "SIGTERM");
    expect(killGroup).toHaveBeenCalledWith(201, "SIGTERM");
    vi.advanceTimersByTime(2_000);
    expect(killGroup).toHaveBeenCalledWith(200, "SIGKILL");
    expect(killGroup).toHaveBeenCalledWith(201, "SIGKILL");
  });

  it("disarms pending timers", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      isLatchActive: () => true,
      isStreaming: () => true,
      scanChildren: () => [child(200)],
      killGroup,
    });

    wd.arm("s1");
    wd.disarm("s1");
    vi.advanceTimersByTime(12_000);
    expect(killGroup).not.toHaveBeenCalled();
  });

  it("fires at most once per arm", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      killGraceMs: 2_000,
      isLatchActive: () => true,
      isStreaming: () => true,
      scanChildren: () => [child(200)],
      killGroup,
    });

    wd.arm("s1");
    vi.advanceTimersByTime(30_000);
    expect(killGroup.mock.calls.filter((c) => c[1] === "SIGTERM")).toHaveLength(1);

    wd.arm("s1");
    vi.advanceTimersByTime(10_000);
    expect(killGroup.mock.calls.filter((c) => c[1] === "SIGTERM")).toHaveLength(2);
  });

  it("zero children no-ops", () => {
    const killGroup = vi.fn();
    const wd = new AbortWatchdog({
      delayMs: 10_000,
      isLatchActive: () => true,
      isStreaming: () => true,
      scanChildren: () => [],
      killGroup,
    });

    wd.arm("s1");
    vi.advanceTimersByTime(10_000);
    expect(killGroup).not.toHaveBeenCalled();
  });
});
