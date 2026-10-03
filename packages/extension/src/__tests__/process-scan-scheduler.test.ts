import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProcessScanScheduler } from "../process-scan-scheduler.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(platform = "linux", result: { changed: boolean } = { changed: false }) {
  const scan = vi.fn(async () => result);
  const s = createProcessScanScheduler({ scan, platform, now: () => Date.now() });
  return { scan, s };
}

describe("process scan scheduler", () => {
  it("E11: idle→fast re-arms within 5 s (Unix)", async () => {
    const { scan, s } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(5_000); // first scan, then idle 30 s armed
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000); // 15 s later, next idle scan is ~15 s away
    scan.mockClear();
    s.onToolStart();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("E11: ≤ 10 s on win32", async () => {
    const { scan, s } = make("win32");
    s.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(20_000);
    scan.mockClear();
    s.onAgentStart();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("E12: fast cadence for 15 s after agent_end, then idle (Unix)", async () => {
    const { scan, s } = make();
    s.start();
    s.onAgentStart();
    await vi.advanceTimersByTimeAsync(10_000);
    s.onAgentEnd();
    scan.mockClear();
    await vi.advanceTimersByTimeAsync(15_000); // scans at +5/+10/+15
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(3);
    scan.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scan.mock.calls.length).toBeLessThanOrEqual(2); // idle 30 s
  });

  it("E12: a list change keeps the fast cadence for 30 s", async () => {
    const { scan, s } = make("linux", { changed: true });
    s.start();
    await vi.advanceTimersByTimeAsync(5_000);
    scan.mockClear();
    scan.mockResolvedValue({ changed: false });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("E13: a Bash tool end triggers one extra scan at +1000 ms", async () => {
    const { scan, s } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(5_000);
    scan.mockClear();
    s.onToolStart();
    s.onToolEnd("Bash");
    await vi.advanceTimersByTimeAsync(999);
    expect(scan).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("non-bash tool end schedules no extra scan", async () => {
    const { scan, s } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(5_000);
    scan.mockClear();
    s.onToolStart();
    s.onToolEnd("read");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(scan).toHaveBeenCalledTimes(0);
  });

  it("E14: a due timer during an in-flight scan starts no second scan", async () => {
    let resolve!: () => void;
    const scan = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const s = createProcessScanScheduler({ scan, platform: "linux", now: () => Date.now() });
    s.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scan).toHaveBeenCalledTimes(1);
    s.onToolStart();
    s.onToolEnd("bash");
    await vi.advanceTimersByTimeAsync(1_000); // one-shot due while in flight
    expect(scan).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("dispose clears timers and ignores a late settle", async () => {
    let resolve!: () => void;
    const scan = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const s = createProcessScanScheduler({ scan, platform: "linux", now: () => Date.now() });
    s.start();
    await vi.advanceTimersByTimeAsync(5_000);
    s.dispose();
    resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
