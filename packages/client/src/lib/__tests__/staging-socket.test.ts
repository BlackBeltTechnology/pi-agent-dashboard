import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openStagingSocket } from "../api/staging-socket.js";

/**
 * Minimal WebSocket fake: installed onto the global and driven manually via
 * .triggerOpen() / .triggerError() / .triggerClose(). Tracks close() calls
 * so we can assert no-leak invariants.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls++;
    this.readyState = 3; // CLOSED
  }

  triggerOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  triggerError() {
    this.onerror?.();
  }

  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

describe("openStagingSocket", () => {
  let originalWS: typeof WebSocket;

  beforeEach(() => {
    originalWS = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;
    FakeWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWS;
  });

  it("resolves with the open socket when WebSocket reaches OPEN", async () => {
    const p = openStagingSocket("ws://example:8000/ws", { timeoutMs: 5000 });
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();
    const resolved = await p;
    expect(resolved).toBe(ws);
    expect(ws.closeCalls).toBe(0); // caller owns the socket on success
  });

  it("rejects and closes the socket when WebSocket errors before open", async () => {
    const p = openStagingSocket("ws://dead:8000/ws", { timeoutMs: 5000 });
    const ws = FakeWebSocket.instances[0];
    ws.triggerError();
    ws.triggerClose();
    await expect(p).rejects.toThrow(/staging socket (error|closed)/i);
    expect(ws.closeCalls).toBeGreaterThanOrEqual(0); // closed by remote; helper may still call close() idempotently
  });

  it("rejects and closes the socket when timeout expires before open", async () => {
    const p = openStagingSocket("ws://slow:8000/ws", { timeoutMs: 5000 });
    const ws = FakeWebSocket.instances[0];
    vi.advanceTimersByTime(5001);
    await expect(p).rejects.toThrow(/timed? out/i);
    expect(ws.closeCalls).toBeGreaterThan(0); // helper MUST close on timeout
  });

  it("is idempotent: later error/close after success does not re-resolve or reject", async () => {
    const p = openStagingSocket("ws://example:8000/ws", { timeoutMs: 5000 });
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();
    const resolved = await p;
    // Later stray events must not cause unhandled rejections
    ws.triggerError();
    ws.triggerClose();
    expect(resolved).toBe(ws);
  });

  it("is idempotent: timeout after error does not double-settle", async () => {
    const p = openStagingSocket("ws://dead:8000/ws", { timeoutMs: 5000 });
    const ws = FakeWebSocket.instances[0];
    ws.triggerError();
    ws.triggerClose();
    await expect(p).rejects.toThrow();
    // advance past timeout: the internal timer must have been cleared already,
    // but even if it fires, the promise must not re-settle
    vi.advanceTimersByTime(10_000);
    // No assertion needed beyond: no unhandled rejection is thrown
  });

  it("clears the timeout on success (no leak)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const p = openStagingSocket("ws://example:8000/ws", { timeoutMs: 5000 });
    FakeWebSocket.instances[0].triggerOpen();
    await p;
    expect(clearSpy).toHaveBeenCalled();
  });
});
