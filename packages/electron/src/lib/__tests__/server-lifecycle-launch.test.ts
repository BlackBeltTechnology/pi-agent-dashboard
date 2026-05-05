/**
 * Unit tests for `requestServerLaunch` idempotency contract.
 * See change: electron-server-launch-controls (R3, task 1.8).
 *
 * NOTE: Full end-to-end coverage of the spawn path is out of scope here —
 * `ensureServer()` shells out to `tsx`/jiti and is exercised by QA harness.
 * These tests cover the wrapper's value-shape contract: failure-as-value,
 * concurrency-share, and the always-running short-circuit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the heavy imports BEFORE importing the SUT.
vi.mock("../health-check.js", () => ({
  isDashboardRunning: vi.fn(),
}));

// We can't easily mock ensureServer() inside the same module — instead the
// tests below either short-circuit on the already-running branch (no spawn)
// or expect the real ensureServer to fail (no tsx in vitest env) and assert
// the failure-as-value behaviour.

import { requestServerLaunch, isManagedServerRunning } from "../server-lifecycle.js";
import { isDashboardRunning } from "../health-check.js";

const mockHealth = isDashboardRunning as unknown as ReturnType<typeof vi.fn>;

describe("requestServerLaunch", () => {
  beforeEach(() => {
    mockHealth.mockReset();
  });

  it("returns already-running when health check reports running", async () => {
    mockHealth.mockResolvedValue({ running: true, pid: 1234 });
    const outcome = await requestServerLaunch();
    expect(outcome.kind).toBe("already-running");
    if (outcome.kind === "already-running") {
      expect(outcome.url).toMatch(/^http:\/\/localhost:\d+$/);
    }
  });

  it("returns failed (never throws) when spawn path errors out", async () => {
    // Server not running → ensureServer() will be called and likely fail in
    // the test sandbox (no tsx, no managed install). We assert the result is
    // a value, not a thrown exception.
    mockHealth.mockResolvedValue({ running: false });
    const outcome = await requestServerLaunch();
    expect(outcome.kind === "failed" || outcome.kind === "started").toBe(true);
    if (outcome.kind === "failed") {
      expect(typeof outcome.reason).toBe("string");
      expect(typeof outcome.logTail).toBe("string");
    }
  });

  it("concurrent calls share one launch attempt", async () => {
    mockHealth.mockResolvedValue({ running: true });
    const [a, b] = await Promise.all([requestServerLaunch(), requestServerLaunch()]);
    expect(a).toEqual(b);
    // Only one health probe should fire for the shared inflight promise.
    // (The second caller awaits the first's promise without re-probing.)
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });
});

describe("isManagedServerRunning", () => {
  beforeEach(() => mockHealth.mockReset());
  it("returns true when health check reports running", async () => {
    mockHealth.mockResolvedValue({ running: true });
    expect(await isManagedServerRunning()).toBe(true);
  });
  it("returns false when health check reports not-running", async () => {
    mockHealth.mockResolvedValue({ running: false });
    expect(await isManagedServerRunning()).toBe(false);
  });
});
