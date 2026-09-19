/**
 * MessageUpdateCoalescer — the D1–D4/D7 unit under test.
 *
 * Covers the test-plan's L1 rows: E1–E16 (window semantics, family split,
 * closed-key drop, fail-open lazy open, flush idempotence, cumulative
 * monotonicity), X1–X3 (dead sink, session boundary, missing key material) and
 * P1/P2 (send-count reduction, one-window tail latency).
 *
 * Fake-timer glue mirrors `subagent-tick-throttle.test.ts`: `vi.useFakeTimers()`
 * in a try/finally, with the wall clock tracked separately so a test can reason
 * about park→send latency and timer scheduling in the same step.
 *
 * See change: coalesce-bridge-message-update-snapshots (tasks 2.1–2.21).
 */
import { describe, expect, it, vi } from "vitest";
import {
  COALESCE_WINDOW_MS,
  isTextSubEvent,
  MessageUpdateCoalescer,
} from "../message-update-coalescer.js";

const W = COALESCE_WINDOW_MS;

interface SentEvent {
  event: any;
  at: number;
}

interface Harness {
  coalescer: MessageUpdateCoalescer;
  sent: SentEvent[];
  /** Offer, recording the wall clock at which the event was parked. */
  offer: (event: unknown, gen: number) => void;
  setClock: (ms: number) => void;
  /** Advance BOTH the tracked clock and the fake timers. */
  advance: (ms: number) => void;
  /** Total `clearTimer` calls (armed-window cancels). */
  cancels: number;
  /** Park→send delay for every send, in milliseconds. */
  delays: () => number[];
}

function makeHarness(opts: { windowMs?: number; isActive?: () => boolean } = {}): Harness {
  const sent: SentEvent[] = [];
  const parkTimes = new WeakMap<object, number>();
  let clock = 0;
  let cancels = 0;
  const live = opts.isActive ?? (() => true);
  const coalescer = new MessageUpdateCoalescer({
    windowMs: opts.windowMs ?? W,
    isActive: () => live(),
    send: (event) => {
      sent.push({ event, at: clock });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => {
      cancels += 1;
      clearTimeout(timer);
    },
  });
  const h: Harness = {
    coalescer,
    sent,
    offer: (event, gen) => {
      if (event && typeof event === "object") parkTimes.set(event as object, clock);
      coalescer.offer(event, gen);
    },
    setClock: (ms) => {
      clock = ms;
    },
    advance: (ms) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    },
    get cancels() {
      return cancels;
    },
    delays: () =>
      sent.map((s) => {
        const parked = parkTimes.get(s.event as object);
        return parked === undefined ? 0 : s.at - parked;
      }),
  };
  return h;
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

/** A `message_update` whose accumulated snapshot text is `text`. */
function update(
  sub: string,
  text?: string,
  meta: { role?: string; timestamp?: number; content?: unknown } = {},
): any {
  const message: any = {
    role: meta.role ?? "assistant",
    timestamp: meta.timestamp ?? 1000,
  };
  if (meta.content !== undefined) message.content = meta.content;
  else if (text !== undefined) message.content = [{ type: "text", text }];
  return {
    type: "message_update",
    message,
    assistantMessageEvent: { type: sub, partial: message },
  };
}

/** The accumulated text a forwarded snapshot carries. */
function textOf(event: any): string | undefined {
  const content = event?.assistantMessageEvent?.partial?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .filter((b: any) => b && b.type === "text")
    .map((b: any) => b.text ?? "")
    .join("");
}

const KEY_1 = "1:assistant:1000";

describe("MessageUpdateCoalescer — window semantics (E1–E6, E14, E16)", () => {
  it("E1: last snapshot wins within a window", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      for (let i = 1; i <= 20; i++) {
        h.setClock((i - 1) * 2);
        h.offer(update("text_delta", "a".repeat(i)), 1);
      }
      // The window is anchored at the FIRST update, so it is already due.
      h.advance(W);
      expect(h.sent).toHaveLength(1);
      expect(textOf(h.sent[0].event)).toBe("a".repeat(20));
    });
  });

  it("E2: just below the bound forwards nothing", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "a"), 1);
      h.advance(W - 1);
      expect(h.sent).toHaveLength(0);
    });
  });

  it("E3: at the bound forwards exactly one", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "a"), 1);
      h.advance(W);
      expect(h.sent).toHaveLength(1);
    });
  });

  it("E4: the window re-arms after it elapses", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "first"), 1);
      h.advance(W + 1);
      h.offer(update("text_delta", "second"), 1);
      h.advance(W);
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["first", "second"]);
    });
  });

  it("E5/P2: a gapless stream is a FIXED window, never a debounce, and never two windows behind", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      // 100 updates, 5 ms apart, for 500 ms.
      for (let i = 0; i < 100; i++) {
        h.offer(update("text_delta", `t${i}`), 1);
        h.advance(5);
      }
      // ceil(500/50) = 10 windows ± 1.
      expect(h.sent.length).toBeGreaterThanOrEqual(9);
      expect(h.sent.length).toBeLessThanOrEqual(11);
      expect(h.sent.length).toBeGreaterThan(1);
      const worst = Math.max(...h.delays());
      expect(worst).toBeLessThanOrEqual(W);
    });
  });

  it("E6: an idle stream forwards nothing", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.advance(200);
      expect(h.sent).toHaveLength(0);
    });
  });

  it("E14: flush() is idempotent", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "once"), 1);
      h.coalescer.flush();
      h.coalescer.flush();
      expect(h.sent).toHaveLength(1);
    });
  });

  it("E16: cumulative snapshots never go backwards", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "abc"), 1);
      h.offer(update("text_delta", "abcdef"), 1);
      h.advance(W);
      // A second window, so the monotonicity check below spans two REAL sends.
      h.offer(update("text_delta", "abcdefghij"), 1);
      h.offer(update("text_delta", "abcdefghijklm"), 1);
      h.advance(W);
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["abcdef", "abcdefghijklm"]);
      const lengths = h.sent.map((s) => textOf(s.event)?.length ?? 0);
      expect(lengths).toHaveLength(2);
      for (let i = 1; i < lengths.length; i++) {
        expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
      }
    });
  });
});

describe("MessageUpdateCoalescer — family split (E7–E9, E8)", () => {
  const UNION = [
    "start",
    "text_start",
    "text_delta",
    "text_end",
    "thinking_start",
    "thinking_delta",
    "thinking_end",
    "toolcall_start",
    "toolcall_delta",
    "toolcall_end",
  ];
  const TEXT = new Set(["text_start", "text_delta", "text_end"]);

  it("E7: only the text-carrying sub-events park; the other seven forward immediately, unmodified", () => {
    withFakeTimers(() => {
      for (const sub of UNION) {
        const h = makeHarness();
        h.coalescer.messageStart(1, KEY_1);
        const ev = update(sub, "x");
        h.offer(ev, 1);
        if (TEXT.has(sub)) {
          expect(h.sent, `${sub} should park`).toHaveLength(0);
          expect(h.coalescer.hasPending, `${sub} should park`).toBe(true);
        } else {
          expect(h.sent, `${sub} should forward`).toHaveLength(1);
          expect(h.sent[0].event, `${sub} must be unmodified`).toBe(ev);
        }
      }
    });
  });

  it("E8: thinking deltas are lossless and in source order", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      const evs = [0, 1, 2, 3, 4].map((i) => update("thinking_delta", `think-${i}`));
      for (const ev of evs) h.offer(ev, 1);
      expect(h.sent).toHaveLength(5);
      // None was replaced by a later one.
      expect(h.sent.map((s) => s.event)).toEqual(evs);
    });
  });

  it("E9: an unrecognised sub-event fails open — pending text first, then the update unmodified", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "pending"), 1);
      const unknown = update("audio_delta", undefined, { content: "audio" });
      h.offer(unknown, 1);
      expect(h.sent).toHaveLength(2);
      expect(textOf(h.sent[0].event)).toBe("pending");
      expect(h.sent[1].event).toBe(unknown);
    });
  });
});

describe("MessageUpdateCoalescer — identity barrier (E10–E13, E11, E12)", () => {
  it("E10: a straggler for a closed identity is dropped", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "final"), 1);
      h.coalescer.flush();
      h.coalescer.messageEnd(1, KEY_1);
      const before = h.sent.length;
      h.offer(update("text_delta", "straggler"), 1);
      h.advance(200);
      expect(h.sent).toHaveLength(before);
    });
  });

  it("E11: an update with no open message opens one instead of dropping it", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      // No messageStart at all — the reload-mid-turn shape.
      h.offer(update("text_delta", "resumed", { timestamp: 2000 }), 7);
      h.advance(W);
      expect(h.sent).toHaveLength(1);
      expect(textOf(h.sent[0].event)).toBe("resumed");
    });
  });

  it("E12: an unseen identity flushes the old snapshot and re-keys the slot", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "old-key"), 1);
      h.offer(update("text_delta", "new-key", { timestamp: 1001 }), 2);
      // The old identity's snapshot went out before the new one was parked.
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["old-key"]);
      h.advance(W);
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["old-key", "new-key"]);
    });
  });

  it("E13: the generation is load-bearing in the key", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      // Two assistant messages created in the SAME millisecond.
      h.coalescer.messageStart(1, "1:assistant:1000");
      h.offer(update("text_delta", "one"), 1);
      h.coalescer.flush();
      h.coalescer.messageEnd(1, "1:assistant:1000");
      h.coalescer.messageStart(2, "2:assistant:1000");
      h.offer(update("text_delta", "two"), 2);
      h.advance(W);
      // The closed key must not swallow generation 2's update.
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["one", "two"]);
    });
  });
});

describe("MessageUpdateCoalescer — lifecycle (E15, X1, X2, X3)", () => {
  it("E15/X2: clear() cancels the window and discards the snapshot", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "abandoned"), 1);
      h.coalescer.clear();
      h.advance(200);
      expect(h.sent).toHaveLength(0);
      expect(h.cancels).toBeGreaterThan(0);
      expect(h.coalescer.hasPending).toBe(false);
    });
  });

  it("E15/X2: a session boundary leaves the new session still functional", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "previous-session"), 1);
      h.coalescer.clear();
      h.advance(200);
      expect(h.sent).toHaveLength(0);
      // The next session's stream is unaffected.
      h.coalescer.messageStart(9, "9:assistant:5000");
      h.offer(update("text_delta", "next-session", { timestamp: 5000 }), 9);
      h.advance(W);
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["next-session"]);
    });
  });

  it("X1: a window that outlives its bridge drops the snapshot without throwing", () => {
    withFakeTimers(() => {
      let active = true;
      const h = makeHarness({ isActive: () => active });
      h.coalescer.messageStart(1, KEY_1);
      h.offer(update("text_delta", "doomed"), 1);
      active = false;
      expect(() => h.advance(W)).not.toThrow();
      expect(h.sent).toHaveLength(0);
    });
  });

  it("X3: a missing timestamp still forwards via a stable fallback identity", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      const first = update("text_delta", "no-ts");
      // `update()` defaults the timestamp, so REMOVE it — otherwise this test
      // would use the normal timestamp key and never touch the WeakMap fallback.
      delete (first.message as { timestamp?: number }).timestamp;
      h.offer(first, 1);
      // Same object → same fallback key, so the drop rule can never fire on it.
      const key = h.coalescer.keyOf(1, first.message);
      expect(key).toMatch(/^1:assistant:f\d+$/);
      expect(key).toBe(h.coalescer.keyOf(1, first.message));
      h.advance(W);
      expect(h.sent).toHaveLength(1);
      expect(textOf(h.sent[0].event)).toBe("no-ts");
    });
  });

  it("binds a message to its start generation, falling back for an unseen one", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      const a = { role: "assistant", timestamp: 1 };
      const b = { role: "assistant", timestamp: 2 };
      h.coalescer.messageStart(1, h.coalescer.keyOf(1, a), a);
      h.coalescer.messageStart(2, h.coalescer.keyOf(2, b), b);
      expect(h.coalescer.generationOf(a, 0)).toBe(1);
      expect(h.coalescer.generationOf(b, 0)).toBe(2);
      // Never seen open — reload mid-turn, or a non-object message.
      expect(h.coalescer.generationOf({ role: "assistant", timestamp: 3 }, 7)).toBe(7);
      expect(h.coalescer.generationOf(undefined, 7)).toBe(7);
    });
  });

  it("E13b: the generation binding keeps a straggler for a CLOSED message dropped", () => {
    withFakeTimers(() => {
      /** A opens at gen 1 then closes; B opens at gen 2. Returns A's message. */
      const setup = (): { h: Harness; messageA: any } => {
        const h = makeHarness();
        const a1 = update("text_delta", "a-final", { timestamp: 1000 });
        const messageA = a1.message;
        h.coalescer.messageStart(1, h.coalescer.keyOf(1, messageA), messageA);
        h.offer(a1, h.coalescer.generationOf(messageA, 0));
        h.coalescer.flush();
        h.coalescer.messageEnd(1, h.coalescer.keyOf(1, messageA));
        const b1 = update("text_delta", "b-first", { timestamp: 2000 });
        const messageB = b1.message;
        h.coalescer.messageStart(2, h.coalescer.keyOf(2, messageB), messageB);
        h.offer(b1, h.coalescer.generationOf(messageB, 0));
        return { h, messageA };
      };
      // The same live object pi mutates in place, carrying no generation.
      const stragglerFor = (messageA: any) => ({
        type: "message_update",
        message: messageA,
        assistantMessageEvent: { type: "text_delta", partial: messageA },
      });

      // Binding path: A still resolves to ITS generation, so keying the
      // straggler hits A's closed identity and it is dropped.
      {
        const { h, messageA } = setup();
        expect(h.coalescer.generationOf(messageA, 2)).toBe(1);
        h.offer(stragglerFor(messageA), h.coalescer.generationOf(messageA, 2));
        h.advance(200);
        expect(h.sent.map((s) => textOf(s.event))).toEqual(["a-final", "b-first"]);
      }

      // Counter-factual: keyed under the counter's CURRENT value instead, the
      // same straggler is accepted and lands after B started — the bug the
      // binding removes. (This is why the assertion above can fail.)
      //
      // A FRESH object, not `messageA`: snapshots hold the live message by
      // reference, so mutating `messageA.content` would retroactively rewrite
      // the already-sent `a-final`. The key arithmetic is identical either way.
      {
        const { h } = setup();
        const aStraggler = update("text_delta", "a-straggler", { timestamp: 1000 });
        h.offer(aStraggler, 2);
        h.advance(200);
        expect(h.sent.map((s) => textOf(s.event))).toEqual([
          "a-final",
          "b-first",
          "a-straggler",
        ]);
      }
    });
  });

  it("markClosed keeps the recent identities and evicts past the memory cap", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      for (let i = 0; i < 100; i++) {
        h.coalescer.messageStart(i, `${i}:assistant:${i}`);
        h.coalescer.messageEnd(i, `${i}:assistant:${i}`);
      }
      // The cap keeps the set bounded rather than growing one entry per message:
      // the most recent identity still drops its straggler...
      h.offer(update("text_delta", "recent-straggler", { timestamp: 99 }), 99);
      h.advance(200);
      expect(h.sent).toHaveLength(0);
      // ...while an identity evicted long ago re-opens instead of being dropped
      // (the accepted trade-off of a bounded memory: the window has long passed).
      h.offer(update("text_delta", "ancient-straggler", { timestamp: 0 }), 0);
      h.advance(W);
      expect(h.sent.map((s) => textOf(s.event))).toEqual(["ancient-straggler"]);
    });
  });
});

describe("MessageUpdateCoalescer — cost and latency (P1, P2)", () => {
  it("P1: a 2000-update turn collapses to ~1 send per window and ~6% of the bytes", () => {
    withFakeTimers(() => {
      const h = makeHarness();
      h.coalescer.messageStart(1, KEY_1);
      // One text_delta every 3 ms for 6 s, each carrying the accumulated text.
      let accumulated = "";
      let baselineBytes = 0;
      const total = 2000;
      const tickMs = 3;
      for (let i = 0; i < total; i++) {
        accumulated += `tok${i} `;
        const ev = update("text_delta", accumulated);
        baselineBytes += Buffer.byteLength(JSON.stringify(ev));
        h.offer(ev, 1);
        h.advance(tickMs);
      }
      const coalescedBytes = h.sent.reduce(
        (sum, s) => sum + Buffer.byteLength(JSON.stringify(s.event)),
        0,
      );
      const durationMs = total * tickMs;
      expect(h.sent.length).toBeLessThanOrEqual(Math.ceil(durationMs / W) + 2);
      // Byte ratio: each send carries a snapshot whose length is proportional to
      // its position in the turn, so baseline ≈ N·L/2 and coalesced ≈ M·L/2 for
      // N source updates and M = duration/W windows — a ratio of M/N = tick/W.
      // For a 3 ms tick and a 50 ms window that is ~6 %; the test-plan's 3 %
      // figure is unattainable for THIS workload (it would need a window twice
      // as long), so the bound below is the arithmetic truth with headroom.
      expect(coalescedBytes).toBeLessThanOrEqual(baselineBytes * 0.07);
      // Let the final window elapse, then assert the last snapshot is complete.
      h.advance(W);
      expect(h.sent.length).toBeLessThanOrEqual(Math.ceil(durationMs / W) + 2);
      expect(textOf(h.sent[h.sent.length - 1].event)).toBe(accumulated);
    });
  });

  it("isTextSubEvent classifies exactly the three text sub-events", () => {
    expect(isTextSubEvent(update("text_start"))).toBe(true);
    expect(isTextSubEvent(update("text_delta"))).toBe(true);
    expect(isTextSubEvent(update("text_end"))).toBe(true);
    expect(isTextSubEvent(update("thinking_delta"))).toBe(false);
    expect(isTextSubEvent(update("toolcall_delta"))).toBe(false);
    expect(isTextSubEvent(update("audio_delta"))).toBe(false);
    expect(isTextSubEvent({ type: "message_update" })).toBe(false);
    expect(isTextSubEvent(undefined)).toBe(false);
  });
});
