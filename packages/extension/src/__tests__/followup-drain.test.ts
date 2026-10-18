/**
 * The pure follow-up drain gate sequence (`followup-drain.ts`), against the real
 * `createFollowupBuffer` and the real `buildUserMessageContent`.
 *
 * Covers test-plan rows E13 (decision table), E14 (content shapes + bytes) and
 * X2 (a synchronous throw drops the entry).
 *
 * See change: update-pi-core-1-3-adopt-apis (design D4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFollowupBuffer } from "../followup-buffer.js";
import { type DrainContext, drainOneFollowup } from "../followup-drain.js";

function makeDrain(opts: {
  initial?: Array<{ text: string; images?: Array<{ type: "image"; data: string; mimeType: string }> }>;
  ctx?: DrainContext | undefined;
  throwOnSend?: boolean;
} = {}) {
  const callLog: string[] = [];
  const buffer = createFollowupBuffer();
  for (const entry of opts.initial ?? []) expect(buffer.push(entry).ok).toBe(true);
  const realShift = buffer.shift.bind(buffer);
  buffer.shift = () => {
    callLog.push("shift");
    return realShift();
  };
  const emitQueueUpdate = vi.fn(() => callLog.push("emit"));
  const sendUserMessage = vi.fn((..._args: unknown[]) => {
    callLog.push("send");
    if (opts.throwOnSend) throw new Error("pi exploded");
  });
  const ctx: DrainContext | undefined =
    "ctx" in opts ? opts.ctx : { hasPendingMessages: () => false, isIdle: () => true };
  const drain = () =>
    drainOneFollowup({
      buffer,
      ctx,
      emitQueueUpdate,
      sendUserMessage: (content) => sendUserMessage(content),
    });
  return { buffer, callLog, emitQueueUpdate, sendUserMessage, drain };
}

describe("drainOneFollowup — gate decision table (E13)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("empty buffer → no probe, no pop, no send", () => {
    const probe = { hasPendingMessages: vi.fn(() => false), isIdle: vi.fn(() => true) };
    const d = makeDrain({ ctx: probe });
    expect(d.drain()).toBe("empty");
    expect(d.callLog).toEqual([]);
    expect(probe.isIdle).not.toHaveBeenCalled();
  });

  it("pi has pending messages → no pop, no send", () => {
    const d = makeDrain({ initial: [{ text: "a" }], ctx: { hasPendingMessages: () => true, isIdle: () => true } });
    expect(d.drain()).toBe("pending");
    expect(d.callLog).toEqual([]);
    expect(d.buffer.length).toBe(1);
  });

  it("not idle → no pop, no send, and no timer scheduled", () => {
    const d = makeDrain({ initial: [{ text: "a" }], ctx: { hasPendingMessages: () => false, isIdle: () => false } });
    expect(d.drain()).toBe("busy");
    expect(d.callLog).toEqual([]);
    expect(d.buffer.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a throwing idle probe counts as not idle", () => {
    const d = makeDrain({
      initial: [{ text: "a" }],
      ctx: { isIdle: () => { throw new Error("probe"); } },
    });
    expect(d.drain()).toBe("busy");
    expect(d.buffer.length).toBe(1);
  });

  it("no ctx at all → treated as not idle", () => {
    const d = makeDrain({ initial: [{ text: "a" }], ctx: undefined });
    expect(d.drain()).toBe("busy");
    expect(d.sendUserMessage).not.toHaveBeenCalled();
  });

  it("an absent hasPendingMessages probe does not block (older pi)", () => {
    const d = makeDrain({ initial: [{ text: "a" }], ctx: { isIdle: () => true } });
    expect(d.drain()).toBe("sent");
  });

  it("all gates pass → order is shift → emit → send", () => {
    const d = makeDrain({ initial: [{ text: "a" }] });
    expect(d.drain()).toBe("sent");
    expect(d.callLog).toEqual(["shift", "emit", "send"]);
  });
});

describe("drainOneFollowup — content shapes and bytes (E14)", () => {
  it("sends a bare string for text only, then a [text, image] array, never with options", () => {
    const FIVE_MIB = 5 * 1024 * 1024;
    const image = { type: "image" as const, data: "A".repeat(FIVE_MIB), mimeType: "image/png" };
    const d = makeDrain({ initial: [{ text: "plain" }, { text: "describe", images: [image] }] });
    const before = d.buffer.totalBytes();
    expect(before).toBeGreaterThanOrEqual(FIVE_MIB);

    d.drain();
    expect(d.sendUserMessage).toHaveBeenNthCalledWith(1, "plain");
    expect(d.sendUserMessage.mock.calls[0]).toHaveLength(1);
    // The first entry's bytes are released; the image-bearing entry is untouched.
    expect(d.buffer.totalBytes()).toBe(before - Buffer.byteLength("plain"));

    d.drain();
    expect(d.sendUserMessage).toHaveBeenNthCalledWith(2, [{ type: "text", text: "describe" }, image]);
    expect(d.sendUserMessage.mock.calls[1]).toHaveLength(1);
    expect(d.buffer.totalBytes()).toBe(0);
  });
});

describe("drainOneFollowup — synchronous send failure (X2)", () => {
  it("warns, drops the entry, and the next drain is a no-op", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = makeDrain({ initial: [{ text: "a" }], throwOnSend: true });

    expect(d.drain()).toBe("lost");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("drainFollowupQueue");
    expect(String(warn.mock.calls[0][0])).toContain("entry lost");
    expect(d.buffer.length).toBe(0);

    expect(d.drain()).toBe("empty");
    expect(d.sendUserMessage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
