import { describe, expect, it } from "vitest";

import { createEditThrottle, shouldSteer, stripSteerPrefix } from "../stream.js";

/** Deterministic clock + timer queue — no real timers. */
function harness(minIntervalMs: number) {
  let clock = 1_000;
  const fired: string[] = [];
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextHandle = 1;
  const cancelled: unknown[] = [];

  const throttle = createEditThrottle({
    minIntervalMs,
    now: () => clock,
    schedule: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fn, at: clock + ms });
      return handle;
    },
    cancel: (handle) => {
      cancelled.push(handle);
      timers.delete(handle as number);
    },
    onFire: (content) => fired.push(content),
  });

  return {
    throttle,
    fired,
    cancelled,
    pendingTimers: () => timers.size,
    advance(ms: number) {
      clock += ms;
      for (const [handle, t] of [...timers.entries()]) {
        if (t.at <= clock) {
          timers.delete(handle);
          t.fn();
        }
      }
    },
  };
}

describe("createEditThrottle (C8/P1 edit throttle)", () => {
  it("P1: a burst yields at most one fire per interval and the LAST content wins", () => {
    const h = harness(1000);
    const first = h.throttle.request("a");
    expect(first).toEqual({ fire: "a" }); // leading edge fires immediately

    // Burst within the interval: every one coalesces.
    expect(h.throttle.request("ab")).toBeNull();
    expect(h.throttle.request("abc")).toBeNull();
    expect(h.throttle.request("abcd")).toBeNull();
    expect(h.fired).toEqual([]);
    expect(h.throttle.pending()).toBe("abcd");

    h.advance(1000);
    // Exactly one trailing fire, carrying the LATEST content — never "ab"/"abc".
    expect(h.fired).toEqual(["abcd"]);
    expect(h.throttle.pending()).toBeNull();
  });

  it("P1: an intermediate value is never emitted after a newer one", () => {
    const h = harness(1000);
    h.throttle.request("v1");
    for (const v of ["v2", "v3", "v4", "v5"]) h.throttle.request(v);
    h.advance(1000);
    h.throttle.request("v6");
    h.advance(1000);
    // Monotonic, no stale re-emission of v2..v4.
    expect(h.fired).toEqual(["v5", "v6"]);
    expect(h.throttle.pending()).toBeNull();
  });

  it("spaced requests past the interval fire on the leading edge each time", () => {
    const h = harness(1000);
    expect(h.throttle.request("a")).toEqual({ fire: "a" });
    h.advance(1000);
    expect(h.throttle.request("b")).toEqual({ fire: "b" });
    expect(h.fired).toEqual([]);
  });

  it("flush() emits the pending latest and cancels the scheduled fire", () => {
    const h = harness(1000);
    h.throttle.request("a");
    h.throttle.request("ab");
    h.throttle.request("abc");
    expect(h.throttle.flush()).toEqual({ fire: "abc" });
    expect(h.throttle.pending()).toBeNull();
    expect(h.cancelled.length).toBe(1);
    h.advance(5000);
    expect(h.fired).toEqual([]); // no duplicate trailing fire
  });

  it("flush() with nothing pending returns null", () => {
    const h = harness(1000);
    expect(h.throttle.flush()).toBeNull();
    h.throttle.request("a");
    expect(h.throttle.flush()).toBeNull();
  });

  it("dispose() cancels a scheduled fire", () => {
    const h = harness(1000);
    h.throttle.request("a");
    h.throttle.request("ab");
    expect(h.pendingTimers()).toBe(1);
    h.throttle.dispose();
    expect(h.cancelled.length).toBe(1);
    expect(h.pendingTimers()).toBe(0);
    expect(h.throttle.pending()).toBeNull();
    h.advance(5000);
    expect(h.fired).toEqual([]);
  });
});

describe("shouldSteer (C7/X6 mid-stream delivery)", () => {
  it("true only for a leading steer prefix", () => {
    expect(shouldSteer("!stop that", "!")).toBe(true);
    expect(shouldSteer("!", "!")).toBe(true);
    expect(shouldSteer("stop that", "!")).toBe(false);
    expect(shouldSteer("do !this", "!")).toBe(false);
    expect(shouldSteer(" !leading space", "!")).toBe(false);
  });

  it("false for an empty prefix and an empty text", () => {
    expect(shouldSteer("anything", "")).toBe(false);
    expect(shouldSteer("", "!")).toBe(false);
    expect(shouldSteer("", "")).toBe(false);
  });

  it("supports a multi-char prefix", () => {
    expect(shouldSteer(">>now", ">>")).toBe(true);
    expect(shouldSteer(">now", ">>")).toBe(false);
  });
});

describe("stripSteerPrefix", () => {
  it("removes exactly one occurrence plus a single following space", () => {
    expect(stripSteerPrefix("!stop", "!")).toBe("stop");
    expect(stripSteerPrefix("! stop", "!")).toBe("stop");
    expect(stripSteerPrefix("!  stop", "!")).toBe(" stop");
    expect(stripSteerPrefix("!!stop", "!")).toBe("!stop");
    expect(stripSteerPrefix(">> go", ">>")).toBe("go");
  });

  it("leaves a non-steer text untouched", () => {
    expect(stripSteerPrefix("stop", "!")).toBe("stop");
    expect(stripSteerPrefix("anything", "")).toBe("anything");
  });
});
