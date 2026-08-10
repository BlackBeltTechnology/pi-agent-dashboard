import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPendingLoadManager } from "../pending/pending-load-manager.js";

// Minimal WebSocket mock
function mockWs(): any {
  return { readyState: 1 };
}

describe("pending-load-manager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts and completes a load", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    const ws = mockWs();

    expect(plm.start("s1", ws, "bridge1")).toBe(true);
    expect(plm.isPending("s1")).toBe(true);

    const browsers = plm.complete("s1");
    expect(browsers).toBeDefined();
    expect(browsers!.has(ws)).toBe(true);
    expect(plm.isPending("s1")).toBe(false);
    plm.dispose();
  });

  it("deduplicates — second start returns false", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);

    plm.start("s1", mockWs(), "bridge1");
    expect(plm.start("s1", mockWs(), "bridge1")).toBe(false);
    plm.dispose();
  });

  it("addBrowser adds to existing pending load", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    const ws1 = mockWs();
    const ws2 = mockWs();

    plm.start("s1", ws1, "bridge1");
    expect(plm.addBrowser("s1", ws2)).toBe(true);

    const browsers = plm.complete("s1");
    expect(browsers!.size).toBe(2);
    expect(browsers!.has(ws1)).toBe(true);
    expect(browsers!.has(ws2)).toBe(true);
    plm.dispose();
  });

  it("addBrowser returns false when no pending load", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    expect(plm.addBrowser("s1", mockWs())).toBe(false);
    plm.dispose();
  });

  it("fires timeout callback after timeout", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout, 5000);
    const ws = mockWs();

    plm.start("s1", ws, "bridge1");
    vi.advanceTimersByTime(5100);

    expect(onTimeout).toHaveBeenCalledWith("s1", expect.any(Set));
    expect(plm.isPending("s1")).toBe(false);
    plm.dispose();
  });

  it("complete cancels timeout", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout, 5000);

    plm.start("s1", mockWs(), "bridge1");
    plm.complete("s1");
    vi.advanceTimersByTime(6000);

    expect(onTimeout).not.toHaveBeenCalled();
    plm.dispose();
  });

  it("cancelForBridge cancels all loads for that bridge", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    const ws1 = mockWs();
    const ws2 = mockWs();

    plm.start("s1", ws1, "bridge-a");
    plm.start("s2", ws2, "bridge-a");
    plm.start("s3", mockWs(), "bridge-b");

    const cancelled = plm.cancelForBridge("bridge-a");
    expect(cancelled.size).toBe(2);
    expect(cancelled.has("s1")).toBe(true);
    expect(cancelled.has("s2")).toBe(true);
    expect(plm.isPending("s1")).toBe(false);
    expect(plm.isPending("s2")).toBe(false);
    expect(plm.isPending("s3")).toBe(true);

    plm.dispose();
  });

  it("cancel removes a specific pending load", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    const ws = mockWs();

    plm.start("s1", ws, "bridge1");
    const browsers = plm.cancel("s1");
    expect(browsers).toBeDefined();
    expect(browsers!.has(ws)).toBe(true);
    expect(plm.isPending("s1")).toBe(false);
    plm.dispose();
  });

  it("cancel returns null for nonexistent load", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    expect(plm.cancel("s1")).toBeNull();
    plm.dispose();
  });

  it("complete returns null for nonexistent load", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout);
    expect(plm.complete("nonexistent")).toBeNull();
    plm.dispose();
  });

  it("dispose clears all pending loads and timers", () => {
    const onTimeout = vi.fn();
    const plm = createPendingLoadManager(onTimeout, 5000);

    plm.start("s1", mockWs(), "bridge1");
    plm.start("s2", mockWs(), "bridge1");
    plm.dispose();

    vi.advanceTimersByTime(6000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
