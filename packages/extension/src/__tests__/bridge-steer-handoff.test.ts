/**
 * Held-steer hand-off at `turn_end` and the steer-buffer mutations, driven
 * through the real `registerTurnEnd` and `handleInboundMessage` over a real
 * `createSteerBuffer` / `createFollowupBuffer`.
 *
 * Covers test-plan rows E5, E6, E11, E12, E13, E14, E15, E16, E17, E22, X1,
 * X2, X5 (E26 lives in bridge-no-queue-mutation.test.ts). See change: bridge-owned-cancellable-steer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleInboundMessage } from "../bridge-handlers/dispatch.js";
import { registerTurnEnd } from "../bridge-handlers/lifecycle.js";
import { createFollowupBuffer } from "../followup-buffer.js";
import { drainOneFollowup } from "../followup-drain.js";
import { createSteerBuffer } from "../steer-buffer.js";
import { makeStubInstance } from "./helpers/bridge-instance-stub.js";

const PNG = (data: string) => ({ type: "image" as const, data, mimeType: "image/png" });

function makeRig(opts: { mode?: unknown; getSettingsThrows?: boolean; sendImpl?: (...a: unknown[]) => unknown } = {}) {
  const steer = createSteerBuffer("n");
  const followUp = createFollowupBuffer();
  const log: string[] = [];
  const sendUserMessage = vi.fn((content: unknown, options?: unknown) => {
    log.push(`send:${typeof content === "string" ? content : (content as Array<{ text?: string }>)[0].text}`);
    return opts.sendImpl?.(content, options);
  });
  const getSettings = vi.fn(() => {
    if (opts.getSettingsThrows) throw new Error("settings unavailable");
    return opts.mode === undefined ? {} : { steeringMode: opts.mode };
  });
  const emitQueueUpdate = vi.fn(() => log.push(`queue:${steer.views().map((v) => v.text).join(",")}`));
  const feedback = vi.fn();
  const drainUsage = vi.fn();
  const { inst, pi, connection } = makeStubInstance({
    bridgeSteer: steer,
    bridgeFollowUp: followUp,
    emitQueueUpdate,
    sendCommandFeedback: feedback,
    drainUsage: drainUsage as never,
    lastFirstMessage: "already sent",
    commandHandler: { handle: vi.fn(async () => undefined) } as never,
    pathGate: { onServerMessage: () => false } as never,
    polling: {} as never,
  });
  Object.assign(pi, { sendUserMessage, getSettings });
  // Real ack, as bridge.ts wires it.
  inst.ackSteerDelivered = (promptId) => {
    if (promptId) (connection.send as (m: unknown) => void)({ type: "prompt_received", sessionId: inst.sessionId, fresh: false, promptId });
  };
  registerTurnEnd(inst);
  const turnEnd = (outcome: string) => pi.handlers.get("turn_end")![0]({ type: "turn_end", outcome }, {});
  const dispatch = (msg: Record<string, unknown>) => handleInboundMessage(inst, { sessionId: "S1", ...msg });
  const acks = () =>
    connection.send.mock.calls.map((c) => c[0]).filter((m: any) => m.type === "prompt_received");
  return { inst, pi, steer, followUp, sendUserMessage, emitQueueUpdate, feedback, drainUsage, log, turnEnd, dispatch, acks };
}

/** Run a turn_end to completion while flushing its macrotask yields. */
async function settle(p: Promise<unknown>) {
  await vi.runAllTimersAsync();
  await p;
}

describe("held-steer hand-off at turn_end", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** What a completed/aborted/error turn_end must send, given the held count and mode. */
  function expectedSends(outcome: string, mode: unknown, held: number): string[] {
    if (outcome !== "completed" || held === 0) return [];
    const all = Array.from({ length: held }, (_, i) => `s${i}`);
    return mode === "all" ? all : all.slice(0, 1);
  }

  it("E11: outcome × steeringMode × held count", async () => {
    const cases = ["completed", "aborted", "error"].flatMap((outcome) =>
      ["one-at-a-time", "all", undefined].flatMap((mode) => [0, 1, 2].map((held) => ({ outcome, mode, held }))),
    );
    for (const { outcome, mode, held } of cases) {
      const r = makeRig({ mode });
      for (let i = 0; i < held; i++) r.steer.push({ text: `s${i}` });
      await settle(r.turnEnd(outcome));
      const label = `${outcome}/${String(mode)}/${held}`;
      const expected = expectedSends(outcome, mode, held);
      expect(r.sendUserMessage.mock.calls.map((c) => c[0]), label).toEqual(expected);
      expect(r.steer.length, label).toBe(held - expected.length);
      expect(r.emitQueueUpdate.mock.calls.length, label).toBe(expected.length > 0 ? 1 : 0);
      expect(r.sendUserMessage.mock.calls.map((c) => c[1]), label).toEqual(expected.map(() => ({ deliverAs: "steer" })));
    }
  });

  it("E12: all-mode removes + announces once BEFORE the first send, sends oldest-first with a macrotask between", async () => {
    const r = makeRig({ mode: "all" });
    r.steer.push({ text: "a" });
    r.steer.push({ text: "b" });
    const done = r.turnEnd("completed");
    // Synchronous part ran: buffer emptied, announced, first send out — but not the second.
    await Promise.resolve();
    expect(r.log).toEqual(["queue:", "send:a"]);
    await settle(done);
    expect(r.log).toEqual(["queue:", "send:a", "send:b"]);
    expect(r.emitQueueUpdate).toHaveBeenCalledTimes(1);
  });

  it("E13: images ride the hand-off as content blocks", async () => {
    const r = makeRig();
    r.steer.push({ text: "see", images: [PNG("AAAA"), PNG("BBBB")] });
    await settle(r.turnEnd("completed"));
    expect(r.sendUserMessage).toHaveBeenCalledWith(
      [{ type: "text", text: "see" }, PNG("AAAA"), PNG("BBBB")],
      { deliverAs: "steer" },
    );
  });

  it("E5: a held steer's promptId is acked at hand-off, not before", async () => {
    const r = makeRig();
    r.steer.push({ text: "a", promptId: "p1" });
    expect(r.acks()).toEqual([]);
    await settle(r.turnEnd("completed"));
    expect(r.acks()).toEqual([{ type: "prompt_received", sessionId: "S1", fresh: false, promptId: "p1" }]);
  });

  it("E6: a cancelled steer never acks its promptId (turn_end + settle drain)", async () => {
    const r = makeRig();
    const pushed = r.steer.push({ text: "a", promptId: "p1" });
    await r.dispatch({ type: "remove_steering_entry", id: pushed.ok ? pushed.id : "" });
    await settle(r.turnEnd("completed"));
    drainOneFollowup({
      buffer: r.followUp,
      steerBuffer: r.steer,
      ctx: { isIdle: () => true, hasPendingMessages: () => false },
      emitQueueUpdate: r.emitQueueUpdate,
      sendUserMessage: r.sendUserMessage,
      ackSteer: r.inst.ackSteerDelivered,
    });
    expect(r.sendUserMessage).not.toHaveBeenCalled();
    expect(r.acks().some((m: any) => m.promptId === "p1")).toBe(false);
  });

  it("E14: a cancel that lands during the yield after a send finds nothing and is refused; the entry is still sent", async () => {
    const r = makeRig({ mode: "all" });
    r.steer.push({ text: "1" });
    r.steer.push({ text: "2" });
    const done = r.turnEnd("completed");
    await Promise.resolve();
    expect(r.log).toEqual(["queue:", "send:1"]);
    await r.dispatch({ type: "remove_steering_entry", id: "n:2" });
    await settle(done);
    expect(r.feedback).toHaveBeenCalledWith("remove_steering_entry", "Steer already sent or cancelled");
    expect(r.sendUserMessage.mock.calls.map((c) => c[0])).toEqual(["1", "2"]);
  });

  it("X1: an asynchronously rejecting send does not escape; buffer already empty, no retry", async () => {
    vi.useRealTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const r = makeRig({ sendImpl: () => Promise.reject(new Error("compaction")) });
      r.steer.push({ text: "a" });
      await r.turnEnd("completed");
      await new Promise((resolve) => setImmediate(resolve));
      expect(r.sendUserMessage).toHaveBeenCalledTimes(1);
      expect(r.steer.length).toBe(0);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("X1b: a send that throws synchronously loses the entry without acking its promptId", async () => {
    const r = makeRig({
      sendImpl: () => {
        throw new Error("pi refused");
      },
    });
    r.steer.push({ text: "a", promptId: "p-lost" });
    await settle(r.turnEnd("completed"));
    expect(r.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(r.steer.length).toBe(0);
    expect(r.acks().filter((m: { promptId?: string }) => m.promptId === "p-lost")).toHaveLength(0);
  });

  it("X2: getSettings throwing falls back to one-at-a-time; the usage drain still ran", async () => {
    const r = makeRig({ getSettingsThrows: true });
    r.steer.push({ text: "a" });
    r.steer.push({ text: "b" });
    await settle(r.turnEnd("completed"));
    expect(r.sendUserMessage.mock.calls.map((c) => c[0])).toEqual(["a"]);
    expect(r.steer.length).toBe(1);
    expect(r.drainUsage).toHaveBeenCalledTimes(1);
  });
});

describe("steer buffer mutations (dispatch)", () => {
  it("E15: remove by id splices one entry, emits once, calls no pi method", async () => {
    const r = makeRig();
    r.steer.push({ text: "1" });
    r.steer.push({ text: "2" });
    await r.dispatch({ type: "remove_steering_entry", id: "n:2" });
    expect(r.steer.views().map((v) => v.text)).toEqual(["1"]);
    expect(r.emitQueueUpdate).toHaveBeenCalledTimes(1);
    expect(r.sendUserMessage).not.toHaveBeenCalled();
  });

  it("E16: an unknown id leaves buffers untouched and is refused with feedback", async () => {
    const r = makeRig();
    r.steer.push({ text: "1" });
    await r.dispatch({ type: "remove_steering_entry", id: "zz" });
    expect(r.steer.length).toBe(1);
    expect(r.emitQueueUpdate).not.toHaveBeenCalled();
    expect(r.feedback).toHaveBeenCalledWith("remove_steering_entry", "Steer already sent or cancelled");
  });

  it("E17: clear empties the steer buffer only, emitting once", async () => {
    const r = makeRig();
    for (const t of ["1", "2", "3"]) r.steer.push({ text: t });
    r.followUp.push({ text: "b" });
    await r.dispatch({ type: "clear_steering_entries" });
    expect(r.steer.length).toBe(0);
    expect(r.followUp.views()).toEqual([{ text: "b", imageCount: 0 }]);
    expect(r.emitQueueUpdate).toHaveBeenCalledTimes(1);
  });

  it("X5: a missing / non-string id never throws and changes nothing", async () => {
    const r = makeRig();
    r.steer.push({ text: "1" });
    await r.dispatch({ type: "remove_steering_entry" });
    await r.dispatch({ type: "remove_steering_entry", id: 7 });
    expect(r.steer.length).toBe(1);
    expect(r.emitQueueUpdate).not.toHaveBeenCalled();
    expect(r.sendUserMessage).not.toHaveBeenCalled();
  });

  it("a steer mutation addressed to another session (stale frame after a switch) changes nothing", async () => {
    const r = makeRig();
    r.steer.push({ text: "held for S1" });
    await r.dispatch({ type: "clear_steering_entries", sessionId: "OLD" });
    await r.dispatch({ type: "remove_steering_entry", sessionId: "OLD", id: "n:1" });
    expect(r.steer.views().map((v) => v.text)).toEqual(["held for S1"]);
    expect(r.emitQueueUpdate).not.toHaveBeenCalled();
    expect(r.feedback).not.toHaveBeenCalled();
  });

  it("E22: abort leaves both buffers alone and emits no queue_update", async () => {
    const r = makeRig();
    r.steer.push({ text: "a" });
    r.followUp.push({ text: "b" });
    await r.dispatch({ type: "abort" });
    expect(r.steer.views().map((v) => v.text)).toEqual(["a"]);
    expect(r.followUp.length).toBe(1);
    expect(r.emitQueueUpdate).not.toHaveBeenCalled();
  });
});
