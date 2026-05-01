/**
 * Tests for the auto-start suppression window driven by `server_restarting`.
 * See change: fix-restart-bridge-auto-start-race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../connection.js";
import { autoStartServer, type AutoStartDeps } from "../server-auto-start.js";

describe("ConnectionManager.pauseAutoStart", () => {
  let cm: ConnectionManager;

  beforeEach(() => {
    cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: class FakeWS { constructor() { /* never connects */ } onopen?: any; onmessage?: any; onclose?: any; onerror?: any; close() { /* no-op */ } },
      watchdogTimeout: 0,
    });
  });

  it("returns false when no pause has been issued", () => {
    expect(cm.shouldSuppressAutoStart()).toBe(false);
  });

  it("returns true within the requested window", () => {
    cm.pauseAutoStart(5000);
    expect(cm.shouldSuppressAutoStart()).toBe(true);
  });

  it("returns false after the window expires", async () => {
    vi.useFakeTimers();
    cm.pauseAutoStart(100);
    expect(cm.shouldSuppressAutoStart()).toBe(true);
    vi.advanceTimersByTime(150);
    expect(cm.shouldSuppressAutoStart()).toBe(false);
    vi.useRealTimers();
  });

  it("ignores non-positive durations", () => {
    cm.pauseAutoStart(0);
    expect(cm.shouldSuppressAutoStart()).toBe(false);
    cm.pauseAutoStart(-1000);
    expect(cm.shouldSuppressAutoStart()).toBe(false);
  });

  it("only extends the window — overlapping pauses don't shrink it", () => {
    vi.useFakeTimers();
    cm.pauseAutoStart(10_000);
    cm.pauseAutoStart(100); // shorter — must not shrink
    vi.advanceTimersByTime(500);
    expect(cm.shouldSuppressAutoStart()).toBe(true);
    vi.useRealTimers();
  });
});

describe("autoStartServer respects shouldSuppressAutoStart", () => {
  function makeDeps(overrides: Partial<AutoStartDeps> = {}): AutoStartDeps {
    return {
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
      launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
      notify: vi.fn(),
      ...overrides,
    };
  }

  const baseConfig = { piPort: 9999, port: 8000, autoStart: true };

  it("skips launchServer while suppression is active", async () => {
    const deps = makeDeps({ shouldSuppressAutoStart: () => true });
    const result = await autoStartServer(baseConfig, deps);
    expect(deps.launchServer).not.toHaveBeenCalled();
    expect(result.server).toBeUndefined();
  });

  it("still runs discovery + health check when suppressed", async () => {
    const deps = makeDeps({
      shouldSuppressAutoStart: () => true,
      isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
    });
    const result = await autoStartServer(baseConfig, deps);
    // Health check found the orchestrator-spawned server — return it.
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(deps.launchServer).not.toHaveBeenCalled();
  });

  it("calls launchServer normally when not suppressed", async () => {
    const deps = makeDeps({ shouldSuppressAutoStart: () => false });
    await autoStartServer(baseConfig, deps);
    expect(deps.launchServer).toHaveBeenCalledTimes(1);
  });

  it("calls launchServer when no predicate is provided (back-compat)", async () => {
    const deps = makeDeps(); // no shouldSuppressAutoStart
    await autoStartServer(baseConfig, deps);
    expect(deps.launchServer).toHaveBeenCalledTimes(1);
  });
});
