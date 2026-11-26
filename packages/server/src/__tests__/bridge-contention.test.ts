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
  formatOriginRefusalLine,
  isPlaceholderRecord,
  isSocketAlive,
  originClass,
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

/**
 * Origin binding (D1/D4): a claim on a non-placeholder record is refused terminally when the
 * newcomer's credential-derived origin differs from the record's, before every accept reason.
 * See change: harden-bridge-session-claim (test-plan BE1-BE11).
 */
describe("decideClaim — origin binding", () => {
  const H = undefined; // hub-local
  const D1 = "device-1";
  const D2 = "device-2";
  const U = "unattributed-remote";
  const rec = (originDeviceId: string | undefined, extra: { source?: string; sessionFile?: string } = {}) => ({
    originDeviceId,
    source: "tui",
    sessionFile: "/h/s.jsonl",
    ...extra,
  });
  const MISMATCH = { outcome: "refuse", reason: "origin-mismatch" };

  it("BE1: refuses a foreign origin against a live, pong-answering incumbent with no probe", () => {
    const pings: number[] = [];
    const incumbent = { ...liveSocket(), ping: () => pings.push(1) } as ProbeableSocket;
    expect(
      decideClaim({ incumbent, newcomer: liveSocket(), recorded: rec(H), newcomerOriginDeviceId: D1 }),
    ).toEqual(MISMATCH);
    expect(pings).toHaveLength(0);
  });

  it("BE2: refuses device -> other device", () => {
    expect(
      decideClaim({ incumbent: liveSocket(), newcomer: liveSocket(), recorded: rec(D1), newcomerOriginDeviceId: D2 }),
    ).toEqual(MISMATCH);
  });

  it("BE3: a closed incumbent does not make a foreign origin acceptable", () => {
    const closed = { readyState: CLOSED } as ProbeableSocket;
    expect(
      decideClaim({ incumbent: closed, newcomer: liveSocket(), recorded: rec(H), newcomerOriginDeviceId: D1 }),
    ).toEqual(MISMATCH);
  });

  it("BE4: an unheld id with a restored record of another origin is refused, not accepted", () => {
    expect(
      decideClaim({ incumbent: undefined, newcomer: liveSocket(), recorded: rec(D1), newcomerOriginDeviceId: H }),
    ).toEqual(MISMATCH);
  });

  it.each([
    ["no incumbent", undefined, { outcome: "accept", reason: "unheld" }],
    ["closed incumbent", { readyState: CLOSED } as ProbeableSocket, { outcome: "accept", reason: "incumbent-closed" }],
    ["live incumbent", liveSocket(), { outcome: "probe" }],
  ])("BE5/BE6: the same origin keeps the existing rules (%s)", (_n, incumbent, expected) => {
    for (const origin of [D1, H]) {
      expect(
        decideClaim({ incumbent, newcomer: liveSocket(), recorded: rec(origin), newcomerOriginDeviceId: origin }),
      ).toEqual(expected);
    }
  });

  it("BE7: unattributed remotes are one class only among themselves", () => {
    const d = (r: string | undefined, n: string | undefined) =>
      decideClaim({ incumbent: undefined, newcomer: liveSocket(), recorded: rec(r), newcomerOriginDeviceId: n });
    expect(d(U, U)).toEqual({ outcome: "accept", reason: "unheld" });
    expect(d(U, D1)).toEqual(MISMATCH);
    expect(d(U, H)).toEqual(MISMATCH);
    expect(d(D1, U)).toEqual(MISMATCH);
    expect(d(H, U)).toEqual(MISMATCH);
  });

  it("BE8: a placeholder is never origin-refused", () => {
    for (const newcomerOriginDeviceId of [H, D2, U]) {
      expect(
        decideClaim({
          incumbent: liveSocket(),
          newcomer: liveSocket(),
          incumbentSource: "unknown",
          recorded: { originDeviceId: D1, source: "unknown" },
          newcomerOriginDeviceId,
        }),
      ).toEqual({ outcome: "accept", reason: "placeholder" });
    }
  });

  it("BE9: only source=unknown without a sessionFile is a placeholder", () => {
    expect(isPlaceholderRecord({ source: "unknown" })).toBe(true);
    expect(isPlaceholderRecord({ source: "unknown", sessionFile: "/h/s.jsonl" })).toBe(false);
    expect(isPlaceholderRecord({ source: "pi" })).toBe(false);
    for (const recorded of [
      { originDeviceId: D1, source: "unknown", sessionFile: "/h/s.jsonl" },
      { originDeviceId: D1, source: "pi" },
    ]) {
      expect(decideClaim({ incumbent: undefined, newcomer: liveSocket(), recorded, newcomerOriginDeviceId: H })).toEqual(MISMATCH);
    }
    expect(
      decideClaim({ incumbent: undefined, newcomer: liveSocket(), recorded: { originDeviceId: D1, source: "unknown" }, newcomerOriginDeviceId: H }),
    ).toEqual({ outcome: "accept", reason: "unheld" });
  });

  it("BE10: a foreign origin reporting the incumbent's pid is refused, not same-pid accepted", () => {
    const host = { kind: "host" } as never;
    const pidTargets = { incumbent: host, newcomer: host, serverPlatform: "linux" };
    const base = {
      incumbent: liveSocket(),
      newcomer: liveSocket(),
      recorded: rec(H),
      incumbentPid: 4242,
      newcomerPid: 4242,
      pidTargets,
    };
    expect(decideClaim({ ...base, newcomerOriginDeviceId: D1 })).toEqual(MISMATCH);
    expect(decideClaim({ ...base, newcomerOriginDeviceId: H })).toEqual({ outcome: "accept", reason: "same-pid" });
  });

  it("BE11: same-pid still needs one pid namespace within one origin", () => {
    const k = (kind: string) => ({ kind }) as never;
    const run = (inc: string, nw: string, serverPlatform: string) =>
      decideClaim({
        incumbent: liveSocket(),
        newcomer: liveSocket(),
        recorded: rec(D1),
        newcomerOriginDeviceId: D1,
        incumbentPid: 4242,
        newcomerPid: 4242,
        pidTargets: { incumbent: k(inc), newcomer: k(nw), serverPlatform },
      }).outcome;
    expect(run("host", "host", "linux")).toBe("accept");
    expect(run("unknown", "unknown", "win32")).toBe("accept");
    expect(run("remote", "remote", "linux")).toBe("probe");
    expect(run("host", "remote", "linux")).toBe("probe");
    expect(run("unknown", "unknown", "linux")).toBe("probe");
  });

  it("a provisional claim claims nothing for any origin pair, even a foreign one", () => {
    for (const newcomerOriginDeviceId of [H, D1]) {
      expect(
        decideClaim({ incumbent: liveSocket(), newcomer: liveSocket(), provisional: true, recorded: rec(D2), newcomerOriginDeviceId }),
      ).toEqual({ outcome: "provisional" });
    }
  });

  it("formats the origin-refusal line with classes only (no pid, no full device id)", () => {
    const prefix = (id: string) => id.slice(0, 8);
    expect(originClass(undefined, prefix)).toBe("hub");
    expect(originClass(U, prefix)).toBe("unattributed");
    expect(originClass("0123456789abcdef", prefix)).toBe("device:01234567");
    const line = formatOriginRefusalLine("S", "hub", "device:01234567");
    expect(line).toBe("[bridge-claim] origin-refused session=S recorded=hub presented=device:01234567");
    expect(line).not.toMatch(/pid/i);
  });
});

describe("origin refusal accounting (BE22-BE24, BX1, BX2)", () => {
  it("BE22: the per-session-id limiter emits at t=0 and t=5000 only, counting all four", () => {
    let t = 0;
    const tracker = createContentionTracker(() => t);
    const emitted: number[] = [];
    for (const at of [0, 4_999, 5_000, 5_001]) {
      t = at;
      if (tracker.record("S")) emitted.push(at);
    }
    expect(emitted).toEqual([0, 5_000]);
    expect(tracker.count()).toBe(4);
  });

  it("BE23: the limiter is per session id", () => {
    const tracker = createContentionTracker(() => 0);
    expect(tracker.record("S1")).toBe(true);
    expect(tracker.record("S2")).toBe(true);
    expect(tracker.count()).toBe(2);
  });

  it("BE24: the origin line classes are exactly hub | device:<8 chars> | unattributed and leak nothing else", () => {
    const D1 = "dev-0123456789abcdef";
    const prefix = (id: string) => id.slice(0, 8);
    const classes = [undefined, D1, "unattributed-remote"].map((o) => originClass(o, prefix));
    expect(classes).toEqual(["hub", "device:dev-0123", "unattributed"]);
    for (const rec of classes) {
      for (const pres of classes) {
        const line = formatOriginRefusalLine("S", rec, pres);
        expect(line).toMatch(/^\[bridge-claim\] origin-refused session=S recorded=(hub|device:\S{8}|unattributed) presented=(hub|device:\S{8}|unattributed)$/);
        expect(line).not.toContain(D1);
        expect(line).not.toMatch(/pid|token|\[gateway\]/i);
      }
    }
  });

  it("BX1: a foreign origin never reaches a probe even when the same origin would be displaced as dead", () => {
    const dead = deadTransportSocket();
    const same = decideClaim({ incumbent: dead, newcomer: liveSocket(), recorded: { originDeviceId: "d", source: "tui", sessionFile: "/f" }, newcomerOriginDeviceId: "d" });
    expect(same).toEqual({ outcome: "probe" });
    expect(resolveProbe(dead, false)).toEqual({ outcome: "displace", reason: "incumbent-dead" });
    expect(decideClaim({ incumbent: dead, newcomer: liveSocket(), recorded: { originDeviceId: "d", source: "tui", sessionFile: "/f" }, newcomerOriginDeviceId: "other" })).toEqual({
      outcome: "refuse",
      reason: "origin-mismatch",
    });
  });

  it("BX2: a silent-but-writable incumbent is refused after the probe for the same origin; a foreign origin is refused with no probe at all", () => {
    const busy = liveSocket();
    const rec = { originDeviceId: "d", source: "tui", sessionFile: "/f" };
    expect(decideClaim({ incumbent: busy, newcomer: liveSocket(), recorded: rec, newcomerOriginDeviceId: "d" })).toEqual({ outcome: "probe" });
    expect(resolveProbe(busy, false)).toEqual({ outcome: "refuse", reason: "incumbent-alive" });
    expect(decideClaim({ incumbent: busy, newcomer: liveSocket(), recorded: rec, newcomerOriginDeviceId: "x" }).outcome).toBe("refuse");
  });
});

