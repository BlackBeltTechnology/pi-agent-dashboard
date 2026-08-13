/**
 * Scenario E21 — gateway timers must not hold the event loop after a failed
 * startup: `stop()` releases the port AND clears the ping interval installed
 * by `start()`. The captured zombie (PID 78379) survived precisely because a
 * closed socket alone does not end a process whose loop a live interval holds.
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, vi } from "vitest";
import { createPiGateway } from "../pi/pi-gateway.js";
import type { SessionManager } from "../session/memory-session-manager.js";

function fakeSessionManager(): SessionManager {
  return {} as unknown as SessionManager;
}

describe("piGateway.stop()", () => {
  it("E21: releases the port and leaves no live interval keeping the loop alive", async () => {
    const gateway = createPiGateway(fakeSessionManager(), { pingInterval: 1_000 });

    const intervals: Array<ReturnType<typeof setInterval>> = [];
    const realSetInterval = globalThis.setInterval;
    const setSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: any, ms: any) => {
      const t = realSetInterval(fn, ms);
      intervals.push(t);
      return t;
    }) as any);
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      gateway.start(0, "127.0.0.1");
      // Wait for the underlying WebSocketServer to bind.
      await vi.waitFor(() => expect(gateway.address()).not.toBeNull());
      expect(intervals.length).toBeGreaterThan(0);

      gateway.stop();

      // Port released…
      expect(gateway.address()).toBeNull();
      // …and every interval the gateway installed was cleared.
      for (const t of intervals) {
        expect(clearSpy).toHaveBeenCalledWith(t);
      }
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      try { gateway.stop(); } catch { /* already stopped */ }
    }
  });
});
