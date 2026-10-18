/**
 * Tests for the system-originated follow-up enqueue path
 * (`enqueueSystemFollowup`) added for the goal-continuation plugin.
 *
 * `enqueueSystemFollowup` and the `isDraining` lock live in bridge.ts, which no
 * test instantiates, so they are mirrored here; everything the drain DECIDES is
 * the REAL `drainOneFollowup` over the REAL `createFollowupBuffer`. The settle
 * trigger itself is covered against the real forwarders in
 * `forwarders-followup-drain.test.ts`.
 *
 * Contract (spec: bridge-followup-queue — "System-originated follow-up
 * enqueue bypasses the streaming gate"):
 *   1. Ungated push — survives `isAgentStreaming === false` (the gate that
 *      `bufferFollowupSend` applies would discard it).
 *   2. Schedules `drainFollowupQueue()` via setTimeout: idle → ships within one
 *      macrotask; busy → the drain returns and the next `agent_settled` ships it.
 *   3. Respects FOLLOWUP_QUEUE_CAP (refuse + warn).
 *   4. Shares ONE buffer + ONE drain with user follow-ups — one entry per
 *      settle under the isDraining lock, no double sendUserMessage race.
 *
 * See changes: add-goal-continuation-plugin, update-pi-core-1-3-adopt-apis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFollowupBuffer, FOLLOWUP_QUEUE_CAP } from "../followup-buffer.js";
import { drainOneFollowup } from "../followup-drain.js";

function makeHarness(opts: { isAgentStreaming: boolean; idle?: boolean } = { isAgentStreaming: false }) {
  const buffer = createFollowupBuffer();
  const sendUserMessage = vi.fn();
  const emit = vi.fn();
  let isDraining = false;
  let isAgentStreaming = opts.isAgentStreaming;
  let idle = opts.idle ?? true;
  const ctx = { hasPendingMessages: () => false, isIdle: () => idle };
  const texts = (): string[] => buffer.entries().map((e) => e.text);

  // Mirror of bufferFollowupSend — GATED on isAgentStreaming.
  function bufferFollowupSend(text: string): void {
    if (!isAgentStreaming) return;
    if (!buffer.push({ text }).ok) return;
    emit();
  }

  // Mirror of the bridge.ts lock around the REAL drain.
  function drainFollowupQueue(): void {
    if (isDraining) return;
    isDraining = true;
    try {
      drainOneFollowup({
        buffer,
        ctx,
        emitQueueUpdate: emit,
        sendUserMessage: (content) => sendUserMessage(content),
      });
    } finally {
      isDraining = false;
    }
  }

  // Mirror of enqueueSystemFollowup — UNGATED, schedules the drain.
  function enqueueSystemFollowup(text: string): void {
    if (typeof text !== "string" || text.length === 0) return;
    const admitted = buffer.push({ text });
    if (!admitted.ok) {
      console.warn("[dashboard] follow-up buffer refused system entry:", admitted.message);
      return;
    }
    emit();
    setTimeout(() => drainFollowupQueue(), 0);
  }

  // Mirror of the forwarders' agent_settled branch: pi is idle at the settle.
  function settle(): void {
    idle = true;
    setTimeout(() => drainFollowupQueue(), 0);
  }

  return {
    buffer, texts, sendUserMessage, emit,
    bufferFollowupSend, enqueueSystemFollowup, drainFollowupQueue, settle,
    setStreaming: (v: boolean) => { isAgentStreaming = v; },
    setIdle: (v: boolean) => { idle = v; },
  };
}

describe("enqueueSystemFollowup: ungated push", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pushes the entry even when isAgentStreaming is false (gate closed)", () => {
    const h = makeHarness({ isAgentStreaming: false, idle: false });
    h.enqueueSystemFollowup("continue");
    expect(h.texts()).toEqual(["continue"]);
  });

  it("contrast: bufferFollowupSend DISCARDS the same entry when gate closed", () => {
    const h = makeHarness({ isAgentStreaming: false });
    h.bufferFollowupSend("continue");
    expect(h.texts()).toEqual([]); // gated path drops it
  });

  it("E19a: idle → ships exactly one fresh-turn sendUserMessage within one macrotask", () => {
    const h = makeHarness({ isAgentStreaming: false, idle: true });
    h.enqueueSystemFollowup("continue");
    expect(h.sendUserMessage).not.toHaveBeenCalled(); // deferred via setTimeout
    vi.advanceTimersByTime(0);
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.sendUserMessage).toHaveBeenCalledWith("continue");
    expect(h.sendUserMessage.mock.calls[0]).toHaveLength(1); // no deliverAs
    expect(h.texts()).toEqual([]);
  });

  it("E19b: busy → not sent until agent_settled, then sent exactly once", () => {
    const h = makeHarness({ isAgentStreaming: true, idle: false });
    h.enqueueSystemFollowup("continue");

    vi.advanceTimersByTime(0);
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(h.texts()).toEqual(["continue"]);
    expect(vi.getTimerCount()).toBe(0); // no idle-retry loop

    h.settle();
    vi.advanceTimersByTime(0);
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.sendUserMessage).toHaveBeenCalledWith("continue");
    expect(h.texts()).toEqual([]);
  });

  it("ignores empty / non-string text", () => {
    const h = makeHarness();
    h.enqueueSystemFollowup("");
    h.enqueueSystemFollowup(undefined as unknown as string);
    expect(h.texts()).toEqual([]);
  });
});

describe("enqueueSystemFollowup: cap honoured", () => {
  it("refuses the new entry with a warning at FOLLOWUP_QUEUE_CAP", () => {
    const h = makeHarness();
    for (let i = 0; i < FOLLOWUP_QUEUE_CAP; i++) h.buffer.push({ text: `x${i}` });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.enqueueSystemFollowup("overflow");
    expect(h.buffer.length).toBe(FOLLOWUP_QUEUE_CAP);
    expect(h.texts()).not.toContain("overflow");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("collision safety: user + system follow-up at the same settle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ship one-per-settle through the single drain, no double send", () => {
    // A user follow-up was buffered DURING the goal-driven turn (gate open),
    // then the judge resolves post-agent_end and enqueues a system follow-up.
    const h = makeHarness({ isAgentStreaming: true, idle: false });
    h.bufferFollowupSend("user ask");      // buffered mid-turn
    h.setStreaming(false);                  // agent_end flips the gate
    h.enqueueSystemFollowup("continue");    // judge verdict after agent_end

    expect(h.texts()).toEqual(["user ask", "continue"]); // both in ONE buffer

    // Still busy at the enqueue timer: nothing ships.
    vi.advanceTimersByTime(0);
    expect(h.sendUserMessage).not.toHaveBeenCalled();

    // First settle ships exactly one (FIFO: user ask wins).
    h.settle();
    vi.advanceTimersByTime(0);
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.sendUserMessage).toHaveBeenCalledWith("user ask");
    expect(h.texts()).toEqual(["continue"]);

    // Next settle drains the goal continuation — still one per turn.
    h.settle();
    vi.advanceTimersByTime(0);
    expect(h.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(h.sendUserMessage).toHaveBeenNthCalledWith(2, "continue");
    expect(h.texts()).toEqual([]);
  });

  it("re-entrant drain during a send does not double-ship", () => {
    const h = makeHarness({ isAgentStreaming: false, idle: true });
    h.buffer.push({ text: "a" });
    h.buffer.push({ text: "b" });
    // Make sendUserMessage attempt a synchronous re-drain (lock must block it).
    h.sendUserMessage.mockImplementation(() => h.drainFollowupQueue());
    h.drainFollowupQueue();
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.texts()).toEqual(["b"]); // only one consumed
  });
});
