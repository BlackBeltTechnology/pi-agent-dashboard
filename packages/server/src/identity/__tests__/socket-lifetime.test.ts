import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_HEARTBEAT_INTERVAL_MS,
  IDENTITY_EXPIRED_CLOSE_CODE,
  installSocketLifetime,
  type LifetimeSocket,
  MAX_TIMER_DELAY_MS,
  scheduleAtExpiry,
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


describe("expiry beyond the 32-bit timer cap (review r2 B1)", () => {
  /** A virtual clock + timer queue so a 40-day lifetime runs in microseconds. */
  function clock(start: number) {
    let t = start;
    const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
    return {
      now: () => t,
      setTimer: (fn: () => void, ms: number) => {
        expect(ms).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS); // never a delay Node would clamp to ~1 ms
        const e = { at: t + ms, fn, cancelled: false };
        timers.push(e);
        return e as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (h: ReturnType<typeof setTimeout>) => {
        (h as unknown as { cancelled: boolean }).cancelled = true;
      },
      advanceTo(to: number) {
        for (;;) {
          const next = timers.filter((x) => !x.cancelled && x.at <= to).sort((a, b) => a.at - b.at)[0];
          if (!next) break;
          t = next.at;
          next.cancelled = true;
          next.fn();
        }
        t = to;
      },
      pending: () => timers.filter((x) => !x.cancelled).length,
    };
  }

  const DAY = 86_400_000;

  it("scheduleAtExpiry re-arms in chunks and fires exactly at expiry, never early", () => {
    const c = clock(0);
    const fire = vi.fn();
    scheduleAtExpiry(40 * DAY, fire, c);
    c.advanceTo(30 * DAY);
    expect(fire).not.toHaveBeenCalled();
    c.advanceTo(40 * DAY - 1);
    expect(fire).not.toHaveBeenCalled();
    c.advanceTo(40 * DAY);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("the returned cancel stops every pending chunk (no timer outlives the socket)", () => {
    const c = clock(0);
    const fire = vi.fn();
    const cancel = scheduleAtExpiry(40 * DAY, fire, c);
    c.advanceTo(26 * DAY); // first chunk fired, second armed
    cancel();
    c.advanceTo(41 * DAY);
    expect(fire).not.toHaveBeenCalled();
  });

  it("an already-past expiry fires at once; a malformed expiry schedules nothing", () => {
    const c = clock(1000);
    const fire = vi.fn();
    scheduleAtExpiry(500, fire, c);
    expect(fire).toHaveBeenCalledTimes(1);
    const none = vi.fn();
    scheduleAtExpiry(Number.NaN, none, c);
    scheduleAtExpiry(undefined, none, c);
    expect(none).not.toHaveBeenCalled();
    expect(c.pending()).toBe(0);
  });

  it("installSocketLifetime closes a socket whose token outlives the cap, at its real expiry", () => {
    const c = clock(0);
    const close = vi.fn();
    const ws = { principalExpiresAt: 40 * DAY, ping: vi.fn(), terminate: vi.fn(), close, on: vi.fn() } as never;
    installSocketLifetime(ws, { ...c, setHeartbeat: () => 0 as never, clearHeartbeat: () => {} });
    c.advanceTo(40 * DAY - 1);
    expect(close).not.toHaveBeenCalled();
    c.advanceTo(40 * DAY);
    expect(close).toHaveBeenCalledWith(IDENTITY_EXPIRED_CLOSE_CODE, "identity expired");
  });
});
