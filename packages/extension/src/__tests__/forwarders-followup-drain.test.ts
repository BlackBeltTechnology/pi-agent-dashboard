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
 *
 * See change: update-pi-core-1-3-adopt-apis (design D4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbortLatch } from "../abort-latch.js";
import { registerEnrichedForwarders } from "../bridge-handlers/forwarders.js";
import { createInstance } from "../bridge-handlers/instance.js";
import { createFollowupBuffer } from "../followup-buffer.js";
import { drainOneFollowup } from "../followup-drain.js";
import { RetryTracker } from "../retry-tracker.js";

const SID = "s1";
const errorEnd = { messages: [{ role: "assistant", stopReason: "error", errorMessage: "503" }] };
const okEnd = { messages: [{ role: "assistant", stopReason: "end_turn" }] };

function makeRig(initial: string[] = ["a"]) {
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

  const inst = createInstance(pi as never, 1, { generation: 1, isAgentStreaming: false } as never, {
    sessionId: SID,
    sessionReady: true,
    safe: (fn: unknown) => fn,
    coalescer: { flush: () => {} },
    polling: {},
    abortLatch,
    retryTracker: new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 }),
    sendSyntheticRetryEvent: vi.fn(),
    drainUsage: vi.fn(),
    runAutoNameOnTurnEnd: vi.fn(),
    emptyActionableGuard: { observe: () => ({ action: "none" }) },
    connection: { send: vi.fn() },
    bridgeFollowUp: buffer,
    bridgeSteering: [],
    emitQueueUpdate,
    enqueueSystemFollowup: vi.fn(),
    drainFollowupQueue: () => {
      drainOneFollowup({
        buffer,
        ctx,
        emitQueueUpdate,
        sendUserMessage: (content) => pi.sendUserMessage(content),
      });
    },
  } as never);
  registerEnrichedForwarders(inst);

  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    await handlers.get(type)!({ type, ...event }, ctx);
  };
  /** Let every pending `setTimeout(_, 0)` run. */
  const flush = () => vi.advanceTimersByTime(0);
  return { pi, state, buffer, abortLatch, latchAtSend, fire, flush };
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
});
