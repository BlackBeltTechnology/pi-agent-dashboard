/**
 * The two-factor contention rule, the same-pid exemption, the placeholder rule,
 * and the contention record / rate-limit lifecycle.
 *
 * These exercise the decisive states directly because the state that separates
 * E7 from E8 — a socket that is `OPEN` but whose TCP transport is no longer
 * writable — is not constructible from a real client socket: anything a client
 * can do to kill its transport also drives the server-side `readyState` away
 * from `OPEN`, which is E3's path, not E8's.
 *
 * See change: fix-duplicate-bridge-registration.
 */

import { describe, expect, it } from "vitest";
import {
  CONTENTION_PROBE_WINDOW,
  CONTENTION_RATE_LIMIT,
  CONTENTION_RECORD_TTL,
  createContentionTracker,
  decideClaim,
  formatContentionLine,
  isSocketAlive,
  type ProbeableSocket,
  resolveProbe,
  WS_OPEN,
} from "../pi/bridge-contention.js";

const CLOSED = 3;

/** A socket that is OPEN with a live, writable TCP transport. */
function liveSocket(): ProbeableSocket {
  return { readyState: WS_OPEN, _socket: { destroyed: false, writable: true } };
}

/** A socket that is OPEN but whose TCP transport is gone. */
function deadTransportSocket(): ProbeableSocket {
  return { readyState: WS_OPEN, _socket: { destroyed: true, writable: false } };
}

describe("contention constants", () => {
  it("pins the values resolved at the design gate", () => {
    expect(CONTENTION_PROBE_WINDOW).toBe(5_000);
    expect(CONTENTION_RECORD_TTL).toBe(60_000);
    expect(CONTENTION_RATE_LIMIT).toBe(5_000);
  });

  it("does not reuse WS_PING_INTERVAL or HEARTBEAT_TIMEOUT (a register would hang)", () => {
    expect(CONTENTION_PROBE_WINDOW).toBeLessThan(60_000);
  });
});

describe("decideClaim", () => {
  it("accepts when no socket holds the id", () => {
    expect(decideClaim({ incumbent: undefined, newcomer: liveSocket() })).toEqual({
      outcome: "accept",
      reason: "unheld",
    });
  });

  // E4
  it("E4: the same socket re-registering is not a contention and issues no probe", () => {
    const ws = liveSocket();
    expect(decideClaim({ incumbent: ws, newcomer: ws })).toEqual({
      outcome: "accept",
      reason: "same-socket",
    });
  });

  // E3
  it("E3: a CLOSED incumbent is displaced with no probe", () => {
    const incumbent: ProbeableSocket = { readyState: CLOSED, _socket: { writable: false } };
    expect(decideClaim({ incumbent, newcomer: liveSocket() })).toEqual({
      outcome: "accept",
      reason: "incumbent-closed",
    });
  });

  // E12
  it("E12: an auto-created placeholder is never a protected incumbent", () => {
    expect(
      decideClaim({
        incumbent: liveSocket(),
        newcomer: liveSocket(),
        incumbentSource: "unknown",
      }),
    ).toEqual({ outcome: "accept", reason: "placeholder" });
  });

  // E10
  it("E10: a newcomer reporting the incumbent's recorded pid replaces it without a probe", () => {
    expect(
      decideClaim({
        incumbent: liveSocket(),
        newcomer: liveSocket(),
        incumbentSource: "tui",
        incumbentPid: 4242,
        newcomerPid: 4242,
      }),
    ).toEqual({ outcome: "accept", reason: "same-pid" });
  });

  // E11
  it("E11: a newcomer reporting a different pid gets no exemption and must be probed", () => {
    expect(
      decideClaim({
        incumbent: liveSocket(),
        newcomer: liveSocket(),
        incumbentSource: "tui",
        incumbentPid: 4242,
        newcomerPid: 9999,
      }),
    ).toEqual({ outcome: "probe" });
  });

  it("grants no exemption when either pid is unknown (it may only avoid a refusal)", () => {
    expect(
      decideClaim({
        incumbent: liveSocket(),
        newcomer: liveSocket(),
        incumbentSource: "tui",
        incumbentPid: undefined,
        newcomerPid: 4242,
      }),
    ).toEqual({ outcome: "probe" });
    expect(
      decideClaim({
        incumbent: liveSocket(),
        newcomer: liveSocket(),
        incumbentSource: "tui",
        incumbentPid: 4242,
        newcomerPid: undefined,
      }),
    ).toEqual({ outcome: "probe" });
  });

  // E9
  it("E9: self-reported register fields cannot change the outcome", () => {
    // `isNew` / `registerReason` are not inputs to the rule at all — the only
    // self-reported field consulted is `pid`, and only in the fail-safe
    // direction. A resume-flavoured register therefore decides exactly as E6.
    const base = {
      incumbent: liveSocket(),
      newcomer: liveSocket(),
      incumbentSource: "tui",
      incumbentPid: 4242,
      newcomerPid: 9999,
    };
    expect(decideClaim(base)).toEqual({ outcome: "probe" });
  });
});

describe("resolveProbe — the two-factor rule", () => {
  // E6
  it("E6: an incumbent that pongs keeps the entry and the newcomer is refused", () => {
    expect(resolveProbe(liveSocket(), true)).toEqual({
      outcome: "refuse",
      reason: "incumbent-alive",
    });
  });

  // E7 — the case that sank the first draft: busy is not dead.
  it("E7: an incumbent that never pongs but is still writable keeps the entry", () => {
    expect(resolveProbe(liveSocket(), false)).toEqual({
      outcome: "refuse",
      reason: "incumbent-alive",
    });
  });

  // E8
  it("E8: an incumbent that neither pongs nor is writable is displaced", () => {
    expect(resolveProbe(deadTransportSocket(), false)).toEqual({
      outcome: "displace",
      reason: "incumbent-dead",
    });
  });

  it("a pong wins even over a dead-looking transport (liveness is demonstrated)", () => {
    expect(resolveProbe(deadTransportSocket(), true).outcome).toBe("refuse");
  });
});

describe("isSocketAlive", () => {
  it("mirrors the ping reaper's own two-factor definition", () => {
    expect(isSocketAlive(liveSocket())).toBe(true);
    expect(isSocketAlive(deadTransportSocket())).toBe(false);
    expect(isSocketAlive({ readyState: WS_OPEN, _socket: null })).toBe(false);
    expect(isSocketAlive({ readyState: WS_OPEN })).toBe(false);
  });
});

describe("formatContentionLine", () => {
  // L1a
  it("L1a: names the session id and both pids", () => {
    const line = formatContentionLine("019fec91", 37660, 17579);
    expect(line).toContain("019fec91");
    expect(line).toContain("37660");
    expect(line).toContain("17579");
  });

  it("L1a: is distinguishable from the ordinary registration line", () => {
    const line = formatContentionLine("S", 1, 2);
    expect(line).not.toMatch(/\[gateway\] session registered: \S+ cwd=/);
  });

  // L2a
  it("L2a: renders an explicit placeholder for an unknown pid rather than omitting it", () => {
    const line = formatContentionLine("S", undefined, undefined);
    expect(line).toContain("unknown");
    expect(line).toContain("incumbentPid=");
    expect(line).toContain("newcomerPid=");
    expect(line).not.toContain("undefined");
  });
});

describe("contention tracker", () => {
  function trackerAt(clock: { t: number }) {
    return createContentionTracker(() => clock.t);
  }

  it("records a refusal, exposes the id, and counts cumulatively", () => {
    const clock = { t: 1000 };
    const tracker = trackerAt(clock);

    expect(tracker.record("S", 37660, 17579)).toBe(true);
    expect(tracker.isContended("S")).toBe(true);
    expect(tracker.contendedIds()).toEqual(["S"]);
    expect(tracker.count()).toBe(1);
    expect(tracker.get("S")).toMatchObject({ incumbentPid: 37660, newcomerPid: 17579 });
  });

  // X9 / F7
  it("X9: rate-limits emission to once per session id per 5 s while still counting every refusal", () => {
    const clock = { t: 0 };
    const tracker = trackerAt(clock);

    expect(tracker.record("S")).toBe(true); // first emits
    clock.t = 1_000;
    expect(tracker.record("S")).toBe(false);
    clock.t = 4_999;
    expect(tracker.record("S")).toBe(false);
    clock.t = 5_000;
    expect(tracker.record("S")).toBe(true); // window elapsed

    // A looping bridge refused for 30 s emits at most once per 5 s …
    expect(tracker.count()).toBe(4); // … but every refusal is counted.
  });

  it("rate-limits per session id, not globally", () => {
    const clock = { t: 0 };
    const tracker = trackerAt(clock);
    expect(tracker.record("S1")).toBe(true);
    expect(tracker.record("S2")).toBe(true);
  });

  // F4
  it("F4: a record expires on its own after the TTL, leaving the counter intact", () => {
    const clock = { t: 0 };
    const tracker = trackerAt(clock);
    tracker.record("S");
    expect(tracker.isContended("S")).toBe(true);

    clock.t = CONTENTION_RECORD_TTL - 1;
    expect(tracker.isContended("S")).toBe(true);

    clock.t = CONTENTION_RECORD_TTL;
    expect(tracker.isContended("S")).toBe(false);
    expect(tracker.contendedIds()).toEqual([]);
    expect(tracker.count()).toBe(1);
  });

  // F4 (reclaim) / F5 (incumbent disconnect or session end)
  it("F5: an explicit clear removes the record and resets the rate limit", () => {
    const clock = { t: 0 };
    const tracker = trackerAt(clock);
    tracker.record("S");
    tracker.clear("S");

    expect(tracker.isContended("S")).toBe(false);
    expect(tracker.contendedIds()).toEqual([]);
    // The next refusal for the id emits again rather than being throttled by
    // the cleared session's window.
    expect(tracker.record("S")).toBe(true);
  });

  // F8
  it("F8: a cleared id leaves the cumulative counter unchanged", () => {
    const tracker = createContentionTracker();
    tracker.record("S");
    tracker.record("S2");
    tracker.clear("S");
    expect(tracker.count()).toBe(2);
    expect(tracker.contendedIds()).toEqual(["S2"]);
  });

  it("F3: an id with no refusal is never contended", () => {
    const tracker = createContentionTracker();
    expect(tracker.isContended("quiet")).toBe(false);
    expect(tracker.count()).toBe(0);
  });
});
