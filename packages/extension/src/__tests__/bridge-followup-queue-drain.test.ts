/**
 * Tests for the bridge-owned-follow-up drain.
 *
 * Drives the REAL gate sequence in `followup-drain.ts` (`drainOneFollowup`) over
 * the REAL `createFollowupBuffer`; only the `isDraining` re-entrancy lock lives
 * in `bridge.ts` and is mirrored by the last block here:
 *
 *   1. Empty-buffer gate (bridgeFollowUp.length > 0)
 *   2. TUI-coexistence gate (ctx.hasPendingMessages() === false)
 *   3. Idle gate (ctx.isIdle() === true) — ONE check, no retry timer: the next
 *      `agent_settled` drains (design D4)
 *   4. POP FIRST (bridgeFollowUp.shift() before any pi call)
 *   5. Emit BEFORE send (emitQueueUpdate runs before pi.sendUserMessage)
 *   6. Single send, no deliverAs (fresh-turn semantics)
 *   7. Catch + drop on pi error (no re-push)
 *
 * Spec: mid-turn-prompt-queue — Requirement "Bridge follow-up drain loop
 * runs on agent_settled with pop-before-send invariant".
 *
 * See changes: rework-mid-turn-prompt-queue, update-pi-core-1-3-adopt-apis.
 */
import { describe, it, expect, vi } from "vitest";
import { drainOneFollowup } from "../followup-drain.js";
import { createFollowupBuffer } from "../followup-buffer.js";

type AnyMock = ((...args: any[]) => any) & ReturnType<typeof vi.fn>;

interface PiLike {
  sendUserMessage: AnyMock;
}

interface CtxLike {
  hasPendingMessages?: AnyMock;
  isIdle?: AnyMock;
}

interface Harness {
  pi: PiLike;
  ctx: CtxLike;
  /** Texts currently in the real buffer. */
  readonly buffer: string[];
  emit: AnyMock;
  callLog: string[];
  drainOnce: () => void;
}

function makeHarness(opts: {
  initial?: string[];
  hasPendingMessages?: boolean | undefined; // undefined => method absent
  throwOnSend?: boolean;
  idle?: boolean; // default true
}): Harness {
  const callLog: string[] = [];

  const pi: PiLike = {
    sendUserMessage: vi.fn((entry: unknown) => {
      callLog.push(`pi.sendUserMessage:${entry}`);
      if (opts.throwOnSend) throw new Error("pi exploded");
    }) as AnyMock,
  };

  const ctx: CtxLike = {
    isIdle: vi.fn(() => {
      callLog.push("ctx.isIdle");
      return opts.idle ?? true;
    }) as AnyMock,
  };
  if (opts.hasPendingMessages !== undefined) {
    ctx.hasPendingMessages = vi.fn(() => {
      callLog.push("ctx.hasPendingMessages");
      return opts.hasPendingMessages!;
    }) as AnyMock;
  }

  const real = createFollowupBuffer();
  for (const text of opts.initial ?? []) real.push({ text });
  const texts = (): string[] => real.entries().map((e) => e.text);
  // Spy on the real shift so the call log shows pop-before-send.
  const shift = real.shift.bind(real);
  real.shift = () => {
    const entry = shift();
    if (entry) callLog.push(`buffer.shift:${entry.text}`);
    return entry;
  };
  const emit = vi.fn(() => {
    callLog.push(`emit:${JSON.stringify(texts())}`);
  }) as AnyMock;

  const drainOnce = (): void => {
    drainOneFollowup({
      buffer: real,
      ctx,
      emitQueueUpdate: emit,
      sendUserMessage: (content) => pi.sendUserMessage(content),
    });
  };

  return {
    pi,
    ctx,
    get buffer() {
      return texts();
    },
    emit,
    callLog,
    drainOnce,
  } as Harness;
}

describe("drainFollowupQueue: pop-before-send invariant", () => {
  it("calls buffer.shift BEFORE pi.sendUserMessage in the call log", () => {
    const h = makeHarness({ initial: ["a"], hasPendingMessages: false });
    h.drainOnce();
    const shiftIdx = h.callLog.findIndex((s) => s.startsWith("buffer.shift:"));
    const sendIdx = h.callLog.findIndex((s) => s.startsWith("pi.sendUserMessage:"));
    expect(shiftIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThan(shiftIdx);
  });

  it("emits queue_update BEFORE pi.sendUserMessage", () => {
    const h = makeHarness({ initial: ["a"], hasPendingMessages: false });
    h.drainOnce();
    const emitIdx = h.callLog.findIndex((s) => s.startsWith("emit:"));
    const sendIdx = h.callLog.findIndex((s) => s.startsWith("pi.sendUserMessage:"));
    expect(emitIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThan(emitIdx);
  });

  it("calls pi.sendUserMessage with NO deliverAs (fresh-turn semantics)", () => {
    const h = makeHarness({ initial: ["a"], hasPendingMessages: false, idle: true });
    h.drainOnce();
    // After ctx.isIdle()=true, pi.sendUserMessage(entry) starts a fresh
    // turn via Agent.prompt(). deliverAs is intentionally omitted because
    // pi's followUpQueue is no longer being drained once the run has settled.
    expect(h.pi.sendUserMessage).toHaveBeenCalledWith("a");
    expect(h.pi.sendUserMessage.mock.calls[0]).toHaveLength(1);
  });
});

describe("drainFollowupQueue: one entry per agent_settled", () => {
  it("drains only ONE entry per call", () => {
    const h = makeHarness({ initial: ["a", "b", "c"], hasPendingMessages: false });
    h.drainOnce();
    expect(h.buffer).toEqual(["b", "c"]);
    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.pi.sendUserMessage).toHaveBeenCalledWith("a");
  });

  it("drains in FIFO order across multiple agent_settled fires", () => {
    const h = makeHarness({ initial: ["a", "b", "c"], hasPendingMessages: false });
    h.drainOnce(); // → "a"
    h.drainOnce(); // → "b"
    h.drainOnce(); // → "c"
    expect(h.buffer).toEqual([]);
    expect(h.pi.sendUserMessage.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    // No deliverAs option on any call — fresh-turn semantics throughout.
    for (const call of h.pi.sendUserMessage.mock.calls) {
      expect(call).toHaveLength(1);
    }
  });

  it("bails when ctx.isIdle returns false, with no retry timer (the next settle drains)", () => {
    vi.useFakeTimers();
    const h = makeHarness({ initial: ["a"], hasPendingMessages: false, idle: false });
    h.drainOnce();
    // Another run already started — buffer untouched, no pi call, no timer.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    expect(h.buffer).toEqual(["a"]);
    expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });
});

describe("drainFollowupQueue: gates", () => {
  it("TUI gate: bails when ctx.hasPendingMessages() returns true", () => {
    const h = makeHarness({ initial: ["a"], hasPendingMessages: true });
    h.drainOnce();
    expect(h.buffer).toEqual(["a"]);
    expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("works when ctx.hasPendingMessages is absent (older pi version)", () => {
    const h = makeHarness({ initial: ["a"], hasPendingMessages: undefined });
    h.drainOnce();
    expect(h.buffer).toEqual([]);
    expect(h.pi.sendUserMessage).toHaveBeenCalledWith("a");
  });

  it("empty-buffer gate: no-op when buffer empty", () => {
    const h = makeHarness({ initial: [], hasPendingMessages: false });
    h.drainOnce();
    expect(h.buffer).toEqual([]);
    expect(h.emit).not.toHaveBeenCalled();
    expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
  });
});

describe("drainFollowupQueue: pi error handling", () => {
  it("entry is LOST when pi.sendUserMessage throws (no re-push)", () => {
    const h = makeHarness({
      initial: ["a"],
      hasPendingMessages: false,
      throwOnSend: true,
    });
    // Suppress the warning log from the drain — it's expected.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.drainOnce();
    expect(h.buffer).toEqual([]); // entry NOT re-pushed
    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("next drain finds empty buffer and no-ops", () => {
    const h = makeHarness({
      initial: ["a"],
      hasPendingMessages: false,
      throwOnSend: true,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.drainOnce();
    h.drainOnce(); // empty-buffer gate
    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("drainFollowupQueue: re-entrancy lock", () => {
  it("synchronous re-entry inside the drain returns early", () => {
    // Simulate re-entry by having pi.sendUserMessage re-invoke drainOnce().
    // The lock must prevent the inner call from doing any work.
    const callLog: string[] = [];
    const buffer: string[] = ["a", "b"];
    const emit = vi.fn(() => callLog.push(`emit:${JSON.stringify([...buffer])}`));

    let isDraining = false;
    let reentrySucceeded = false;
    const drainOnce = (): void => {
      if (isDraining) {
        reentrySucceeded = true;
        return;
      }
      isDraining = true;
      try {
        if (buffer.length === 0) return;
        const entry = buffer.shift()!;
        callLog.push(`shift:${entry}`);
        emit();
        // Synchronous re-entry attempt inside the same frame.
        drainOnce();
        callLog.push(`outer-done:${entry}`);
      } finally {
        isDraining = false;
      }
    };

    drainOnce();
    expect(buffer).toEqual(["b"]); // only one entry consumed
    expect(reentrySucceeded).toBe(true); // re-entry tried but was blocked
    expect(callLog).toEqual(["shift:a", "emit:[\"b\"]", "outer-done:a"]);
  });
});
