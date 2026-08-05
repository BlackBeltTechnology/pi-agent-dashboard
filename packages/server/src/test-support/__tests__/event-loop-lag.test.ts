/**
 * Guards the lag monitor against reporting a FALSE ZERO.
 *
 * The monitor exists to fail the perf gate when a fit blocks the loop. If it
 * can return 0 for a loop that was demonstrably blocked, the gate silently
 * passes the exact regression it was built to catch — so the monitor's own
 * failure mode matters more than its precision.
 *
 * See change: fit-attachments-for-display (round-4 review, threads 7/9).
 */
import { describe, expect, it } from "vitest";
import { startLagMonitor } from "../event-loop-lag.js";

/** Block the loop synchronously — no timer callback can run during this. */
function blockFor(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // spin
  }
}

describe("startLagMonitor", () => {
  it("records a block that lands before the first tick ever fires", () => {
    const monitor = startLagMonitor(10);
    // Everything here is synchronous, so setInterval cannot have fired once by
    // the time stop() runs. This is the shape of a fit that blocks immediately.
    blockFor(100);
    const lag = monitor.stop();

    expect(lag, "a 100ms block must not report as zero lag").toBeGreaterThan(50);
  });

  it("peek() also sees a block that no tick has observed yet", () => {
    const monitor = startLagMonitor(10);
    blockFor(100);
    const seen = monitor.peek();
    monitor.stop();

    expect(seen, "peek must not under-report an in-progress block").toBeGreaterThan(50);
  });

  it("reports near-zero lag for an unblocked loop", async () => {
    const monitor = startLagMonitor(10);
    await new Promise((r) => setTimeout(r, 60));
    const lag = monitor.stop();

    // Generous: CI hosts jitter. The point is that it is not ~100ms.
    expect(lag).toBeLessThan(50);
  });
});
