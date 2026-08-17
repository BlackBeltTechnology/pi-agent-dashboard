/**
 * SubagentTickThrottle — the D2/D3 unit under test.
 *
 * Covers the test-plan's L1 rows: E1–E9 (window semantics, disabled path,
 * predicate, per-key independence, idle TTL), X1–X6 (fire-time gating,
 * lifecycle disposal, connection-loss retention, terminal discard) and P5
 * (map-bound soak).
 *
 * Fake-timer glue mirrors the debounce/rate-cap tests in `ui-modules.test.ts`
 * (`vi.useFakeTimers()` in a try/finally). The clock is injected separately via
 * `now` so a test can advance wall-time reasoning and timer scheduling in the
 * same step without depending on `vi.setSystemTime` semantics.
 *
 * See change: reduce-bridge-tick-bandwidth (tasks 3.1–3.17).
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TICK_IDLE_TTL_MS,
  isSubagentTick,
  SubagentTickThrottle,
} from "../subagent-tick-throttle.js";

const W = 500;

interface Harness {
  throttle: SubagentTickThrottle<string>;
  /** Frames that reached the wire, in order (leading edge + trailing sends). */
  sent: string[];
  /** Drive a tick through the same shape the bridge's forward loop uses. */
  tick: (key: string, msg: string, sessionId?: string) => void;
  setClock: (ms: number) => void;
  /** Advance BOTH the injected clock and the fake timers by `ms`. */
  advance: (ms: number) => void;
  gate: { ok: boolean; sessionId: string };
}

function makeHarness(opts: { windowMs?: number; idleTtlMs?: number } = {}): Harness {
  const sent: string[] = [];
  let clock = 0;
  const gate = { ok: true, sessionId: "S1" };
  const throttle = new SubagentTickThrottle<string>({
    windowMs: opts.windowMs ?? W,
    idleTtlMs: opts.idleTtlMs,
    now: () => clock,
    // Resolved at CALL time, exactly like the bridge's live-connection lookup.
    send: (msg) => sent.push(msg),
    canSend: (sessionId) => gate.ok && sessionId === gate.sessionId,
  });
  return {
    throttle,
    sent,
    gate,
    tick: (key, msg, sessionId = "S1") => {
      if (throttle.offer(key, msg, sessionId)) sent.push(msg);
    },
    setClock: (ms) => { clock = ms; },
    advance: (ms) => { clock += ms; vi.advanceTimersByTime(ms); },
  };
}

/** Run `fn` under fake timers, always restoring real ones. */
function withFakeTimers(fn: () => void): void {
  vi.useFakeTimers();
  try {
    fn();
  } finally {
    vi.useRealTimers();
  }
}

describe("SubagentTickThrottle — window semantics", () => {
  it("E1: forwards the first tick for a key synchronously on the leading edge", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      expect(h.sent).toEqual(["A"]);
      expect(h.throttle.stats.tickForwarded).toBe(1);
      expect(h.throttle.stats.tickCoalesced).toBe(0);
      // Synchronous: nothing is waiting on a timer.
      expect(vi.getTimerCount()).toBe(1); // only the idle-TTL sweep
    });
  });

  it("E2: coalesces latest-wins — A and C are sent, B never is", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(100);
      h.tick("tc1", "B");
      h.advance(100);
      h.tick("tc1", "C");
      expect(h.sent).toEqual(["A"]);

      h.advance(300); // t = 500, the trailing timer fires
      expect(h.sent).toEqual(["A", "C"]);
      expect(h.sent).not.toContain("B");
      expect(h.throttle.stats.tickCoalesced).toBe(1);
      expect(h.throttle.stats.tickForwarded).toBe(2);
    });
  });

  it("E3: a tick at exactly t=W takes the leading edge and arms no trailing timer", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(W);
      h.tick("tc1", "B");
      expect(h.sent).toEqual(["A", "B"]);
      // Only the idle-TTL sweep may remain armed; no trailing send is pending.
      h.advance(W);
      expect(h.sent).toEqual(["A", "B"]);
    });
  });

  it("E4: a tick at t=W−1 is held and sent once at t=W", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(W - 1);
      h.tick("tc1", "B");
      expect(h.sent).toEqual(["A"]);

      h.advance(1); // t = W
      expect(h.sent).toEqual(["A", "B"]);
      // Single trailing send — the window does not re-fire.
      h.advance(5 * W);
      expect(h.sent).toEqual(["A", "B"]);
    });
  });

  it("E5: windowMs=0 disables the throttle — every tick forwards, nothing coalesces", () => {
    withFakeTimers(() => {
      const h = makeHarness({ windowMs: 0 });
      for (let i = 0; i < 50; i++) {
        h.tick("tc1", `f${i}`);
        h.advance(2); // 50 ticks across 100 ms
      }
      expect(h.sent).toHaveLength(50);
      expect(h.throttle.stats.tickCoalesced).toBe(0);
      expect(h.throttle.stats.tickForwarded).toBe(50);
      // The rollback path keeps NO state at all.
      expect(h.throttle.size).toBe(0);
      expect(h.throttle.enabled).toBe(false);
    });
  });

  it("E7: two concurrent runs are throttled independently, with no cross-suppression", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      // 2 s of interleaved 10 Hz ticks on tc1 and tc2.
      for (let i = 0; i < 20; i++) {
        h.tick("tc1", `a${i}`);
        h.tick("tc2", `b${i}`);
        h.advance(100);
      }
      const a = h.sent.filter((m) => m.startsWith("a"));
      const b = h.sent.filter((m) => m.startsWith("b"));
      // ~2 Hz over 2 s per key, allowing for the leading edge.
      expect(a.length).toBeGreaterThanOrEqual(4);
      expect(a.length).toBeLessThanOrEqual(6);
      expect(b.length).toEqual(a.length);
      // Neither key suppressed the other: both streams advanced.
      expect(a[a.length - 1]).not.toBe("a0");
      expect(b[b.length - 1]).not.toBe("b0");
    });
  });
});

describe("SubagentTickThrottle — idle TTL bound", () => {
  it("E8: sweeps a key whose tool_execution_end never arrived", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      expect(h.throttle.size).toBe(1);

      h.advance(DEFAULT_TICK_IDLE_TTL_MS + 1);
      expect(h.throttle.size).toBe(0);
      // No timer left armed: the sweep does not re-arm over an empty map.
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("E9: does NOT sweep a key still ticking — the TTL is idle-based, not absolute", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      for (let i = 1; i <= 3; i++) {
        h.advance(30_000);
        h.tick("tc1", `A${i}`);
      }
      // 90 s of wall clock, but never 60 s of silence.
      expect(h.throttle.size).toBe(1);
      expect(h.sent).toHaveLength(4);
    });
  });
});

describe("SubagentTickThrottle — terminal ordering", () => {
  it("X6: discards (never flushes) a held tick when the run ends", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(100);
      h.tick("tc1", "held");
      expect(h.sent).toEqual(["A"]);

      h.throttle.onTerminal("tc1");
      expect(h.throttle.stats.tickDiscardedAtTerminal).toBe(1);
      expect(h.throttle.size).toBe(0);

      // The pending frame must never reach the wire, at any later time.
      h.advance(10 * W);
      expect(h.sent).toEqual(["A"]);
    });
  });

  it("X6 anti-vacuity: WITHOUT the discard the held tick would land after the end", () => {
    withFakeTimers(() => {
      // Same sequence, but the terminal hook is not invoked — i.e. exactly the
      // code path a removed `onTerminal` call leaves behind. The held frame
      // DOES arrive late, so the assertion above is falsifiable rather than
      // passing because nothing was pending in the first place.
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(100);
      h.tick("tc1", "held");
      h.advance(10 * W);
      expect(h.sent).toEqual(["A", "held"]);
    });
  });

  it("P5: 500 sequential runs return the map to 0, peaking at one key", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      let peak = 0;
      for (let i = 0; i < 500; i++) {
        const key = `tc${i}`;
        h.tick(key, `${key}-a`);
        h.advance(100);
        h.tick(key, `${key}-b`);
        peak = Math.max(peak, h.throttle.size);
        h.throttle.onTerminal(key);
        expect(h.throttle.size).toBe(0);
        h.advance(100);
      }
      expect(peak).toBeLessThanOrEqual(2);
      expect(h.throttle.size).toBe(0);
    });
  });
});

describe("SubagentTickThrottle — fire-time gating", () => {
  it("X1: drops a held tick when sessionReady flipped false while it waited", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(100);
      h.tick("tc1", "held");

      h.gate.ok = false; // sessionReady / readiness gate closes mid-window
      expect(() => h.advance(W)).not.toThrow();
      expect(h.sent).toEqual(["A"]);
      expect(h.throttle.stats.tickDroppedNotReady).toBe(1);
    });
  });

  it("X2: a superseded bridge instance sends nothing when its timer fires", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A");
      h.advance(100);
      h.tick("tc1", "held");

      h.gate.ok = false; // isActive() is false — a newer instance took over
      h.advance(W);
      expect(h.sent).toEqual(["A"]);
      expect(h.throttle.stats.tickDroppedNotReady).toBe(1);
    });
  });

  it("X3: a frame whose sessionId drifted is not sent", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.tick("tc1", "A", "S1");
      h.advance(100);
      h.tick("tc1", "held", "S1");

      h.gate.sessionId = "S2"; // session changed while the tick was pending
      h.advance(W);
      expect(h.sent).toEqual(["A"]);
      expect(h.throttle.stats.tickDroppedNotReady).toBe(1);
    });
  });

  it("X4: reset() clears every timer and drops every held frame", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      for (const key of ["tc1", "tc2", "tc3"]) h.tick(key, `${key}-lead`);
      h.advance(100);
      for (const key of ["tc1", "tc2", "tc3"]) h.tick(key, `${key}-held`);
      expect(h.throttle.size).toBe(3);

      h.throttle.reset(); // session change, then shutdown
      h.throttle.reset();
      expect(h.throttle.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      h.advance(10 * W);
      expect(h.sent).toEqual(["tc1-lead", "tc2-lead", "tc3-lead"]);
    });
  });

  it("X5: the trailing send goes over the LIVE connection after a reconnect", () => {
    withFakeTimers(() => {
      // Two connection objects: the one live when the frame was HELD, and the
      // one live when the timer FIRES. `send` resolves the live one at call
      // time, so a captured reference would be visible as a send to `stale`.
      const stale: string[] = [];
      const live: string[] = [];
      let current = stale;
      let clock = 0;
      const throttle = new SubagentTickThrottle<string>({
        windowMs: W,
        now: () => clock,
        send: (msg) => current.push(msg),
        canSend: () => true,
      });
      const advance = (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); };

      throttle.offer("tc1", "A", "S1");
      advance(100);
      expect(throttle.offer("tc1", "held", "S1")).toBe(false);

      current = live; // connection dropped and reconnected
      advance(W);

      expect(live).toEqual(["held"]);
      expect(stale).toEqual([]);
    });
  });
});

describe("isSubagentTick — E6 scope predicate decision table", () => {
  const cases: Array<[string, { toolName: string; partialResult: unknown }, boolean]> = [
    [
      "Agent update carrying details.agentId",
      { toolName: "Agent", partialResult: { details: { agentId: "a1" } } },
      true,
    ],
    [
      "Agent update WITHOUT an agentId",
      { toolName: "Agent", partialResult: { details: { entries: [] } } },
      false,
    ],
    [
      "Bash update with an agentId-lookalike",
      { toolName: "Bash", partialResult: { details: { agentId: "a1" } } },
      false,
    ],
    [
      "Bash update with a plain string partial",
      { toolName: "Bash", partialResult: "streaming output" },
      false,
    ],
  ];

  for (const [label, event, expected] of cases) {
    it(`${expected ? "throttles" : "passes 1:1"}: ${label}`, () => {
      expect(isSubagentTick(event)).toBe(expected);
    });
  }

  it("tolerates a missing partialResult without throwing", () => {
    expect(isSubagentTick({ toolName: "Agent" })).toBe(false);
    expect(isSubagentTick({})).toBe(false);
  });
});
