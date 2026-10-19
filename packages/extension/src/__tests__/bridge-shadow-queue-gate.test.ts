/**
 * Tests for the bridge's shadow-queue streaming gate.
 *
 * Repro for the bug "STEERING (1) appears on the very first message to an
 * idle session". The fix has TWO layers:
 *
 * 1. Capture-before-send (primary gate): at the call site of
 *    `pi.sendUserMessage`, the caller MUST snapshot
 *    `isAgentStreaming` BEFORE invoking sendUserMessage. Pi flips
 *    idle→streaming synchronously inside sendUserMessage by emitting
 *    `agent_start`, whose handler in bridge.ts flips the flag in its
 *    first sync line. Checking the flag AFTER the send always reads
 *    true — the original bug. Tests `record*Sent + wasStreaming`
 *    encode that contract.
 *
 * 2. Internal gate (defense in depth): `recordSteerSent` /
 *    `recordFollowupSent` themselves re-check `isStreaming()` so a
 *    caller that forgets to capture pre-send still doesn't corrupt
 *    the shadow queue.
 *
 * The follow-up boundary is `agent_settled` (the drain moved off `agent_end`).
 *
 * See changes: add-followup-edit-and-steer-cancel, update-pi-core-1-3-adopt-apis.
 */
import { describe, it, expect, vi } from "vitest";

interface ShadowQueue {
  steering: string[];
  followUp: string[];
}

/**
 * Pure version of the gate as it lives in bridge.ts. Mirrors the closure
 * logic 1:1; if the production code drifts from this shape, this test
 * should drift in lockstep.
 */
function makeShadowRecorder(opts: {
  isStreaming: () => boolean;
  onEmit: (snapshot: ShadowQueue) => void;
}) {
  const queue: ShadowQueue = { steering: [], followUp: [] };
  function emit() { opts.onEmit({ steering: [...queue.steering], followUp: [...queue.followUp] }); }
  function recordSteer(text: string) {
    if (!opts.isStreaming()) return;
    queue.steering.push(text);
    emit();
  }
  function recordFollowup(text: string) {
    if (!opts.isStreaming()) return;
    queue.followUp = [text];
    emit();
  }
  function clearSteer() { queue.steering = []; emit(); }
  function clearFollowup() { queue.followUp = []; emit(); }
  function drainSteerOnTurnEnd() { if (queue.steering.length > 0) { queue.steering = []; emit(); } }
  function drainFollowupOnAgentSettled() { if (queue.followUp.length > 0) { queue.followUp = []; emit(); } }
  return { recordSteer, recordFollowup, clearSteer, clearFollowup, drainSteerOnTurnEnd, drainFollowupOnAgentSettled, snapshot: () => ({ ...queue, steering: [...queue.steering], followUp: [...queue.followUp] }) };
}

describe("bridge shadow queue: streaming gate", () => {
  it("recordSteer is a no-op when isStreaming === false (idle first message)", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    r.recordSteer("hello");

    expect(r.snapshot().steering).toEqual([]);
    expect(onEmit).not.toHaveBeenCalled();
  });

  it("recordFollowup is a no-op when isStreaming === false (idle first message)", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    r.recordFollowup("after done");

    expect(r.snapshot().followUp).toEqual([]);
    expect(onEmit).not.toHaveBeenCalled();
  });

  it("recordSteer appends + emits when streaming", () => {
    let streaming = true;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    r.recordSteer("A");
    r.recordSteer("B");

    expect(r.snapshot().steering).toEqual(["A", "B"]);
    expect(onEmit).toHaveBeenCalledTimes(2);
    expect(onEmit.mock.calls[1][0]).toEqual({ steering: ["A", "B"], followUp: [] });
  });

  it("recordFollowup replaces slot + emits when streaming (capacity 1)", () => {
    let streaming = true;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    r.recordFollowup("first");
    r.recordFollowup("second");

    expect(r.snapshot().followUp).toEqual(["second"]);
    expect(onEmit).toHaveBeenCalledTimes(2);
  });
});

describe("bridge shadow queue: drain boundaries", () => {
  it("turn_end drains steering only (followUp untouched)", () => {
    let streaming = true;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });
    r.recordSteer("s1");
    r.recordFollowup("f1");
    onEmit.mockClear();

    r.drainSteerOnTurnEnd();

    expect(r.snapshot()).toEqual({ steering: [], followUp: ["f1"] });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("agent_settled drains followUp only (steering untouched)", () => {
    let streaming = true;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });
    r.recordSteer("s1");
    r.recordFollowup("f1");
    onEmit.mockClear();

    r.drainFollowupOnAgentSettled();

    expect(r.snapshot()).toEqual({ steering: ["s1"], followUp: [] });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("turn_end on empty steering does NOT emit (idempotent / no spurious broadcasts)", () => {
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => true, onEmit });

    r.drainSteerOnTurnEnd();

    expect(onEmit).not.toHaveBeenCalled();
  });

  it("agent_settled on empty followUp does NOT emit", () => {
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => true, onEmit });

    r.drainFollowupOnAgentSettled();

    expect(onEmit).not.toHaveBeenCalled();
  });
});

describe("bridge shadow queue: clears", () => {
  it("clearSteer wipes + emits regardless of streaming state", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });
    // Populate via a streaming-on phase, then go idle and clear.
    streaming = true; r.recordSteer("x"); streaming = false; onEmit.mockClear();

    r.clearSteer();

    expect(r.snapshot().steering).toEqual([]);
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("clearFollowup wipes + emits regardless of streaming state", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });
    streaming = true; r.recordFollowup("y"); streaming = false; onEmit.mockClear();

    r.clearFollowup();

    expect(r.snapshot().followUp).toEqual([]);
    expect(onEmit).toHaveBeenCalledTimes(1);
  });
});

describe("bridge shadow queue: capture-before-send semantics (PRIMARY gate)", () => {
  // Simulates the command-handler / sessionPrompt call sites where the bug
  // originally lived. The fix: capture streaming state into a local var
  // BEFORE calling pi.sendUserMessage. The internal recordX gate is a
  // safety net only.

  /** Stand-in for the simplified call-site logic in command-handler.ts. */
  function send(opts: {
    text: string;
    delivery: "steer" | "followUp";
    isStreaming: () => boolean;
    piSendUserMessage: () => void; // simulates the synchronous agent_start flip
    onSteer: (text: string) => void;
    onFollowup: (text: string) => void;
  }) {
    const wasStreaming = opts.isStreaming();
    opts.piSendUserMessage();
    if (wasStreaming) {
      if (opts.delivery === "steer") opts.onSteer(opts.text);
      else opts.onFollowup(opts.text);
    }
  }

  it("idle send DOES NOT record even when pi flips isStreaming synchronously inside sendUserMessage", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    send({
      text: "first message",
      delivery: "steer",
      isStreaming: () => streaming,
      // Pi receives the message, fires agent_start synchronously, which
      // flips `streaming` to true. This was the original bug.
      piSendUserMessage: () => { streaming = true; },
      onSteer: r.recordSteer,
      onFollowup: r.recordFollowup,
    });

    expect(r.snapshot()).toEqual({ steering: [], followUp: [] });
    expect(onEmit).not.toHaveBeenCalled();
  });

  it("streaming send DOES record (chip appears for mid-turn steer)", () => {
    let streaming = true;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    send({
      text: "redirect",
      delivery: "steer",
      isStreaming: () => streaming,
      piSendUserMessage: () => { /* still streaming */ },
      onSteer: r.recordSteer,
      onFollowup: r.recordFollowup,
    });

    expect(r.snapshot().steering).toEqual(["redirect"]);
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("idle followUp also DOES NOT record (same race shape)", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    send({
      text: "after done",
      delivery: "followUp",
      isStreaming: () => streaming,
      piSendUserMessage: () => { streaming = true; },
      onSteer: r.recordSteer,
      onFollowup: r.recordFollowup,
    });

    expect(r.snapshot()).toEqual({ steering: [], followUp: [] });
    expect(onEmit).not.toHaveBeenCalled();
  });
});

describe("bridge shadow queue: realistic follow-up scenario", () => {
  it("send followUp while idle (first message of session) shows no chip", () => {
    let streaming = false;
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => streaming, onEmit });

    // User sends their initial prompt; pi starts a new turn directly,
    // it doesn't queue. The bridge must NOT record a chip.
    r.recordFollowup("kick off the task");

    expect(r.snapshot().followUp).toEqual([]);
    expect(onEmit).not.toHaveBeenCalled();

    // Pi fires agent_start → streaming flips on.
    streaming = true;

    // User adds a follow-up mid-stream → chip appears.
    r.recordFollowup("when you finish, run the tests");
    expect(r.snapshot().followUp).toEqual(["when you finish, run the tests"]);
    expect(onEmit).toHaveBeenCalledTimes(1);

    // Agent finishes → followUp drains.
    r.drainFollowupOnAgentSettled();
    expect(r.snapshot().followUp).toEqual([]);
  });

  it("rapid edit (steering still active) replaces slot atomically", () => {
    const onEmit = vi.fn();
    const r = makeShadowRecorder({ isStreaming: () => true, onEmit });

    r.recordFollowup("v1");
    r.recordFollowup("v2");
    r.recordFollowup("v3");

    expect(r.snapshot().followUp).toEqual(["v3"]);
    expect(onEmit).toHaveBeenCalledTimes(3);
  });
});
