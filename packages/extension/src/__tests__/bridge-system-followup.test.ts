/**
 * Tests for the system-originated follow-up enqueue path
 * (`enqueueSystemFollowup`) added for the goal-continuation plugin.
 *
 * Pure mirror of bridge.ts `enqueueSystemFollowup()` + its interaction with
 * the shared `bridgeFollowUp` buffer / `drainFollowupQueue` (same harness
 * style as bridge-followup-queue-drain.test.ts — no bridge import).
 *
 * Contract (spec: bridge-followup-queue — "System-originated follow-up
 * enqueue bypasses the streaming gate"):
 *   1. Ungated push — survives `isAgentStreaming === false` (the gate that
 *      `bufferFollowupSend` applies would discard it).
 *   2. Schedules `drainFollowupQueue(0)` via setTimeout so the drain re-runs
 *      after the bridge's own agent_end drain already ran on an empty buffer.
 *   3. Respects FOLLOWUP_QUEUE_CAP (drop + warn).
 *   4. Shares ONE buffer + ONE drain with user follow-ups — one entry per
 *      agent_end under the isDraining lock, no double sendUserMessage race.
 *
 * See change: add-goal-continuation-plugin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FOLLOWUP_QUEUE_CAP = 20;

/**
 * Mirror harness: the shared buffer plus the two enqueue paths and the
 * single drain, 1:1 with bridge.ts.
 */
function makeHarness(opts: { isAgentStreaming: boolean; idle?: boolean } = { isAgentStreaming: false }) {
  const buffer: string[] = [];
  const sendUserMessage = vi.fn();
  const emit = vi.fn();
  let isDraining = false;
  let isAgentStreaming = opts.isAgentStreaming;
  const idle = opts.idle ?? true;

  // Mirror of bufferFollowupSend — GATED on isAgentStreaming.
  function bufferFollowupSend(text: string): void {
    if (!isAgentStreaming) return;
    if (buffer.length >= FOLLOWUP_QUEUE_CAP) return;
    buffer.push(text);
    emit();
  }

  // Mirror of drainFollowupQueue — one entry per call under the lock.
  function drainFollowupQueue(): void {
    if (isDraining) return;
    if (buffer.length === 0) return;
    if (!idle) return;
    isDraining = true;
    try {
      const entry = buffer.shift()!;
      emit();
      sendUserMessage(entry);
    } finally {
      isDraining = false;
    }
  }

  // Mirror of enqueueSystemFollowup — UNGATED, schedules drain.
  function enqueueSystemFollowup(text: string): void {
    if (typeof text !== "string" || text.length === 0) return;
    if (buffer.length >= FOLLOWUP_QUEUE_CAP) {
      console.warn("[dashboard] follow-up buffer at soft cap; dropping system entry");
      return;
    }
    buffer.push(text);
    emit();
    setTimeout(() => drainFollowupQueue(), 0);
  }

  return {
    buffer, sendUserMessage, emit,
    bufferFollowupSend, enqueueSystemFollowup, drainFollowupQueue,
    setStreaming: (v: boolean) => { isAgentStreaming = v; },
  };
}

describe("enqueueSystemFollowup: ungated push", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pushes the entry even when isAgentStreaming is false (gate closed)", () => {
    const h = makeHarness({ isAgentStreaming: false });
    h.enqueueSystemFollowup("continue");
    expect(h.buffer).toEqual(["continue"]);
  });

  it("contrast: bufferFollowupSend DISCARDS the same entry when gate closed", () => {
    const h = makeHarness({ isAgentStreaming: false });
    h.bufferFollowupSend("continue");
    expect(h.buffer).toEqual([]); // gated path drops it
  });

  it("schedules a drain that ships exactly one fresh-turn sendUserMessage", () => {
    const h = makeHarness({ isAgentStreaming: false, idle: true });
    h.enqueueSystemFollowup("continue");
    expect(h.sendUserMessage).not.toHaveBeenCalled(); // deferred via setTimeout
    vi.runAllTimers();
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.sendUserMessage).toHaveBeenCalledWith("continue");
    expect(h.sendUserMessage.mock.calls[0]).toHaveLength(1); // no deliverAs
    expect(h.buffer).toEqual([]);
  });

  it("ignores empty / non-string text", () => {
    const h = makeHarness();
    h.enqueueSystemFollowup("");
    h.enqueueSystemFollowup(undefined as unknown as string);
    expect(h.buffer).toEqual([]);
  });
});

describe("enqueueSystemFollowup: cap honoured", () => {
  it("drops the new entry with a warning at FOLLOWUP_QUEUE_CAP", () => {
    const h = makeHarness();
    for (let i = 0; i < FOLLOWUP_QUEUE_CAP; i++) h.buffer.push(`x${i}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.enqueueSystemFollowup("overflow");
    expect(h.buffer).toHaveLength(FOLLOWUP_QUEUE_CAP);
    expect(h.buffer).not.toContain("overflow");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("collision safety: user + system follow-up at same agent_end", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ship one-per-agent_end through the single drain, no double send", () => {
    // A user follow-up was buffered DURING the goal-driven turn (gate open),
    // then the judge resolves post-agent_end and enqueues a system follow-up.
    const h = makeHarness({ isAgentStreaming: true, idle: true });
    h.bufferFollowupSend("user ask");      // buffered mid-turn
    h.setStreaming(false);                  // agent_end flips the gate
    h.enqueueSystemFollowup("continue");    // judge verdict after agent_end

    expect(h.buffer).toEqual(["user ask", "continue"]); // both in ONE buffer

    // First agent_end drain ships exactly one (FIFO: user ask wins).
    vi.runAllTimers();
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.sendUserMessage).toHaveBeenCalledWith("user ask");
    expect(h.buffer).toEqual(["continue"]);

    // Next agent_end drains the goal continuation — still one per turn.
    h.drainFollowupQueue();
    expect(h.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(h.sendUserMessage).toHaveBeenNthCalledWith(2, "continue");
    expect(h.buffer).toEqual([]);
  });

  it("re-entrant drain during a send does not double-ship", () => {
    const h = makeHarness({ isAgentStreaming: false, idle: true });
    h.buffer.push("a", "b");
    // Make sendUserMessage attempt a synchronous re-drain (lock must block it).
    h.sendUserMessage.mockImplementation(() => h.drainFollowupQueue());
    h.drainFollowupQueue();
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.buffer).toEqual(["b"]); // only one consumed
  });
});
