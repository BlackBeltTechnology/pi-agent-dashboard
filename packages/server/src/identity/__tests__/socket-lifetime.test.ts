import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_HEARTBEAT_INTERVAL_MS,
  IDENTITY_EXPIRED_CLOSE_CODE,
  installSocketLifetime,
  type LifetimeSocket,
} from "../socket-lifetime.js";

/** A fake socket + a manual timer harness that captures scheduled callbacks. */
function harness(principalExpiresAt: number | undefined, now = 1000) {
  const close = vi.fn();
  const terminate = vi.fn();
  const ping = vi.fn();
  let pong: (() => void) | undefined;
  const ws: LifetimeSocket = {
    principalExpiresAt,
    ping,
    terminate,
    close,
    on: (_e, l) => {
      pong = l;
    },
  };
  let timerFn: (() => void) | undefined;
  let timerDelay: number | undefined;
  let heartbeatFn: (() => void) | undefined;
  const clearTimer = vi.fn();
  const clearHeartbeat = vi.fn();
  const cleanup = installSocketLifetime(ws, {
    now: () => now,
    setTimer: (fn, ms) => {
      timerFn = fn;
      timerDelay = ms;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer,
    setHeartbeat: (fn) => {
      heartbeatFn = fn;
      return 2 as unknown as ReturnType<typeof setInterval>;
    },
    clearHeartbeat,
  });
  return {
    close,
    terminate,
    ping,
    firePong: () => pong?.(),
    fireExpiry: () => timerFn?.(),
    tickHeartbeat: () => heartbeatFn?.(),
    get expiryDelay() {
      return timerDelay;
    },
    cleanup,
    clearTimer,
    clearHeartbeat,
  };
}

describe("installSocketLifetime — identity expiry (§9.4)", () => {
  it("schedules a close at principalExpiresAt", () => {
    const h = harness(5000, 1000);
    expect(h.expiryDelay).toBe(4000);
    h.fireExpiry();
    expect(h.close).toHaveBeenCalledWith(IDENTITY_EXPIRED_CLOSE_CODE, "identity expired");
  });

  it("closes immediately when already past expiry", () => {
    const h = harness(500, 1000);
    expect(h.close).toHaveBeenCalledWith(IDENTITY_EXPIRED_CLOSE_CODE, "identity expired");
    expect(h.expiryDelay).toBeUndefined();
  });

  it("schedules no expiry timer for a principal-less socket", () => {
    const h = harness(undefined);
    expect(h.expiryDelay).toBeUndefined();
    expect(h.close).not.toHaveBeenCalled();
  });
});

describe("installSocketLifetime — transport heartbeat (§9.5)", () => {
  it("pings on each tick and terminates after a missed pong", () => {
    const h = harness(undefined);
    h.tickHeartbeat(); // alive=true → ping, alive=false
    expect(h.ping).toHaveBeenCalledTimes(1);
    expect(h.terminate).not.toHaveBeenCalled();
    h.tickHeartbeat(); // no pong since → terminate
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  it("a pong keeps the socket alive across ticks", () => {
    const h = harness(undefined);
    h.tickHeartbeat();
    h.firePong();
    h.tickHeartbeat();
    expect(h.terminate).not.toHaveBeenCalled();
    expect(h.ping).toHaveBeenCalledTimes(2);
  });

  it("a heartbeat does NOT extend identity past expiry", () => {
    const h = harness(5000, 1000);
    // Keep the transport alive forever…
    for (let i = 0; i < 5; i++) {
      h.tickHeartbeat();
      h.firePong();
    }
    expect(h.terminate).not.toHaveBeenCalled();
    // …the independent expiry timer still closes on time.
    h.fireExpiry();
    expect(h.close).toHaveBeenCalledWith(IDENTITY_EXPIRED_CLOSE_CODE, "identity expired");
  });
});

describe("installSocketLifetime — cleanup", () => {
  it("clears both timers", () => {
    const h = harness(5000, 1000);
    h.cleanup();
    expect(h.clearTimer).toHaveBeenCalled();
    expect(h.clearHeartbeat).toHaveBeenCalled();
  });

  it("uses the default heartbeat interval constant", () => {
    expect(BROWSER_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
  });
});
