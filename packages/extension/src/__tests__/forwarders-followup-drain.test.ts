/**
 * The follow-up drain TRIGGER: the real `registerEnrichedForwarders` wired to
 * the real `drainOneFollowup` over the real `createFollowupBuffer`, driven with
 * pi's event order. Only the `isDraining` re-entrancy lock (bridge.ts) and pi
 * itself are absent.
 *
 * The drain moved from `agent_end` to `agent_settled`: pi clears its run-active
 * flag BEFORE it emits `agent_settled`, so a timer scheduled from the settle sees
 * an idle session and the old 100 ms x 20 idle-retry loop is gone.
 *
 * Covers test-plan rows E15, E16, E17, E18.
 * Held steers (bridge-owned-cancellable-steer): E18, E19, E21 of that plan.
 *
 * See change: update-pi-core-1-3-adopt-apis (design D4),
 * bridge-owned-cancellable-steer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbortLatch } from "../abort-latch.js";
import { registerEnrichedForwarders } from "../bridge-handlers/forwarders.js";
import { createInstance } from "../bridge-handlers/instance.js";
import { createFollowupBuffer } from "../followup-buffer.js";
import { drainOneFollowup } from "../followup-drain.js";
import { RetryTracker } from "../retry-tracker.js";
import { createSteerBuffer } from "../steer-buffer.js";

const SID = "s1";
const errorEnd = { messages: [{ role: "assistant", stopReason: "error", errorMessage: "503" }] };
const okEnd = { messages: [{ role: "assistant", stopReason: "end_turn" }] };

function makeRig(initial: string[] = ["a"], held: Array<{ text: string; promptId?: string }> = []) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
  const abortLatch = new AbortLatch();
  const latchAtSend: boolean[] = [];
  const pi = {
    on: vi.fn((type: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => {
      handlers.set(type, handler);
    }),
    sendUserMessage: vi.fn((..._args: unknown[]) => {
      latchAtSend.push(abortLatch.isActive(SID));
    }),
  };
  const state = { idle: true, pending: false };
  const ctx = { isIdle: () => state.idle, hasPendingMessages: () => state.pending };
  const buffer = createFollowupBuffer();
  for (const text of initial) buffer.push({ text });
  const emitQueueUpdate = vi.fn();
  const steer = createSteerBuffer("n");
  for (const entry of held) steer.push(entry);
  const acks: Array<string | undefined> = [];

  const inst = createInstance(pi as never, 1, { generation: 1, isAgentStreaming: false } as never, {
    sessionId: SID,
    sessionReady: true,
    safe: (fn: unknown) => fn,
    coalescer: { flush: () => {}, messageStart: () => {} },
    messageKeyOf: () => "k",
    wrapAppendMessageForCtx: () => {},
    wrapCustomPersistenceForCtx: () => {},
    nextNonce: () => "nonce",
    pendingNonces: new WeakMap(),
    assistantMessageGen: 0,
    extractUserMessageText: (m: { content?: unknown }) => (typeof m?.content === "string" ? m.content : ""),
    polling: {},
    abortLatch,
    retryTracker: new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 }),
    sendSyntheticRetryEvent: vi.fn(),
    drainUsage: vi.fn(),
    runAutoNameOnTurnEnd: vi.fn(),
    emptyActionableGuard: { observe: () => ({ action: "none" }), reset: () => {} },
    connection: { send: vi.fn() },
    bridgeFollowUp: buffer,
    bridgeSteer: steer,
    emitQueueUpdate,
    enqueueSystemFollowup: vi.fn(),
    drainFollowupQueue: () => {
      drainOneFollowup({
        buffer,
        steerBuffer: steer,
        ctx,
        emitQueueUpdate,
        sendUserMessage: (content) => pi.sendUserMessage(content),
        ackSteer: (promptId) => acks.push(promptId),
      });
    },
  } as never);
  registerEnrichedForwarders(inst);

  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    await handlers.get(type)!({ type, ...event }, ctx);
  };
  /** Let every pending `setTimeout(_, 0)` run. */
  const flush = () => vi.advanceTimersByTime(0);
  return { pi, state, buffer, steer, acks, emitQueueUpdate, abortLatch, latchAtSend, fire, flush };
}

describe("follow-up drain trigger (agent_settled)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("E15: agent_end alone never drains; agent_settled drains exactly one entry", async () => {
    const r = makeRig(["a"]);

    await r.fire("agent_start");
    await r.fire("agent_end", okEnd);
    r.flush();
    expect(r.pi.sendUserMessage).not.toHaveBeenCalled();
    expect(r.buffer.length).toBe(1);

    await r.fire("agent_settled");
    r.flush();
    expect(r.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(r.pi.sendUserMessage).toHaveBeenCalledWith("a");
    expect(r.buffer.length).toBe(0);
  });

  it("E16: an auto-retry chain drains once, after the final settle", async () => {
    const r = makeRig(["a"]);

    for (let attempt = 0; attempt < 2; attempt++) {
      await r.fire("agent_start");
      await r.fire("agent_end", errorEnd);
      r.flush();
      expect(r.pi.sendUserMessage).not.toHaveBeenCalled();
    }
    await r.fire("agent_start");
    await r.fire("agent_end", okEnd);
    r.flush();
    expect(r.pi.sendUserMessage).not.toHaveBeenCalled();

    await r.fire("agent_settled");
    r.flush();
    expect(r.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(r.pi.sendUserMessage).toHaveBeenCalledWith("a");
  });

  it("E17: an aborted settle drains the next entry, with the abort latch already cleared", async () => {
    const r = makeRig(["a"]);
    r.abortLatch.request(SID);

    await r.fire("agent_settled", { aborted: true });
    r.flush();

    expect(r.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(r.pi.sendUserMessage).toHaveBeenCalledWith("a");
    expect(r.latchAtSend).toEqual([false]);
  });

  it("E18: busy at the drain → no pop and no retry timer; the next settle ships it", async () => {
    const r = makeRig(["a"]);

    r.state.idle = false;
    await r.fire("agent_settled");
    r.flush();
    expect(r.pi.sendUserMessage).not.toHaveBeenCalled();
    expect(r.buffer.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    r.state.idle = true;
    await r.fire("agent_settled");
    r.flush();
    expect(r.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(r.pi.sendUserMessage).toHaveBeenCalledWith("a");
  });

  it("steer E19: a held steer ships first (fresh prompt + promptId ack), one per settle; the follow-up waits", async () => {
    const r = makeRig(["b"], [{ text: "a", promptId: "p2" }]);

    await r.fire("agent_settled");
    r.flush();
    expect(r.pi.sendUserMessage.mock.calls).toEqual([["a"]]);
    expect(r.acks).toEqual(["p2"]);
    expect(r.steer.length).toBe(0);
    expect(r.buffer.length).toBe(1);

    await r.fire("agent_settled");
    r.flush();
    expect(r.pi.sendUserMessage.mock.calls).toEqual([["a"], ["b"]]);
    expect(r.acks).toEqual(["p2"]);
  });

  it("steer E21: after an abort a held steer gets the same settle verdict as a follow-up in its place", async () => {
    const steerRig = makeRig([], [{ text: "a" }]);
    const followRig = makeRig(["a"]);
    for (const r of [steerRig, followRig]) {
      r.abortLatch.request(SID);
      await r.fire("agent_settled", { aborted: true });
      r.flush();
    }
    expect(steerRig.pi.sendUserMessage.mock.calls).toEqual(followRig.pi.sendUserMessage.mock.calls);
    expect(steerRig.latchAtSend).toEqual(followRig.latchAtSend);
  });

  it("steer E18: a user message_start with a held steer's text never touches the steer buffer", async () => {
    const r = makeRig([], [{ text: "hello" }]);
    await r.fire("message_start", { message: { role: "user", content: "hello", timestamp: 1 } });
    r.flush();
    expect(r.steer.views().map((v) => v.text)).toEqual(["hello"]);
    expect(r.emitQueueUpdate).not.toHaveBeenCalled();
  });
});
