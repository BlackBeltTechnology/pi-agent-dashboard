/**
 * Bridge-owned steer buffer: admission bounds, ids, take order, and the
 * routing that puts a streaming steer into it — driven through the real
 * `createCommandHandler` → `admitSteer` → `createSteerBuffer` path.
 *
 * Covers test-plan rows E1, E2, E3, E4, E7, E8, E9, E10.
 *
 * @structural-pin the bridge.ts sessionPrompt fallback is a closure inside the bridge factory, not instantiable in a unit test; E3 pins its steer branch in the source text, with the same admission path covered behaviourally via command-handler above
 * See change: bridge-owned-cancellable-steer.
 */
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { describe, expect, it, vi } from "vitest";
import { createCommandHandler } from "../command-handler.js";
import { createFollowupBuffer, FOLLOWUP_QUEUE_CAP } from "../followup-buffer.js";
import { admitSteer, createSteerBuffer } from "../steer-buffer.js";
import { readBridgeSource } from "./helpers/bridge-source.js";

const PNG = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };

function mockPi() {
  return {
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    getCommands: vi.fn().mockReturnValue([]),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    on: vi.fn(),
    exec: vi.fn(),
  };
}

/** Real handler + real steer/follow-up buffers, wired like bridge.ts. */
function makeRig(opts: { streaming: () => boolean; pi?: ReturnType<typeof mockPi> }) {
  const pi = opts.pi ?? mockPi();
  const steer = createSteerBuffer("n1");
  const followUp = createFollowupBuffer();
  const queueUpdates: unknown[] = [];
  const feedback: Array<{ command: string; message: string }> = [];
  const events: any[] = [];
  const sinks = {
    sendCommandFeedback: (command: string, message: string) => feedback.push({ command, message }),
    emitQueueUpdate: () => queueUpdates.push({ steering: steer.views(), followUp: followUp.views() }),
  };
  const handler = createCommandHandler(pi as any, "s1", {
    eventSink: (m) => events.push(m),
    isStreaming: opts.streaming,
    onSteerBuffered: (text, images, promptId) => admitSteer(steer, { text, images, promptId }, sinks),
    onFollowupSent: (text, images) => {
      followUp.push({ text, ...(images ? { images: images as never } : {}) });
      sinks.emitQueueUpdate();
    },
  });
  const send = (msg: Record<string, unknown>) =>
    handler.handle({ type: "send_prompt", sessionId: "s1", ...msg } as unknown as ServerToExtensionMessage);
  return { pi, steer, followUp, queueUpdates, feedback, events, send, sinks };
}

describe("steer routing (command-handler passthrough)", () => {
  it("E1: a streaming steer is held, never sent to pi, and announced with its image count", async () => {
    const r = makeRig({ streaming: () => true });
    await r.send({ text: "focus on auth", delivery: "steer", images: [PNG] });

    expect(r.pi.sendUserMessage).toHaveBeenCalledTimes(0);
    expect(r.steer.length).toBe(1);
    expect(r.queueUpdates).toHaveLength(1);
    expect(r.queueUpdates[0]).toEqual({
      steering: [{ id: "n1:1", text: "focus on auth", imageCount: 1 }],
      followUp: [],
    });
  });

  it("E2: an idle steer goes to pi directly even when pi flips streaming inside the send", async () => {
    let streaming = false;
    const pi = mockPi();
    pi.sendUserMessage.mockImplementation(() => {
      streaming = true; // pi fires agent_start synchronously on an idle send
    });
    const r = makeRig({ streaming: () => streaming, pi });
    await r.send({ text: "hello", delivery: "steer" });

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "steer" });
    expect(r.steer.length).toBe(0);
    expect(r.queueUpdates).toHaveLength(0);
  });

  it("E4: delivery × streaming decision table", async () => {
    const cases = [
      { delivery: "steer", streaming: true, steer: 1, followUp: 0, piCalls: 0 },
      { delivery: "followUp", streaming: true, steer: 0, followUp: 1, piCalls: 0 },
      { delivery: "steer", streaming: false, steer: 0, followUp: 0, piCalls: 1 },
      { delivery: "followUp", streaming: false, steer: 0, followUp: 0, piCalls: 1 },
    ] as const;
    for (const c of cases) {
      const r = makeRig({ streaming: () => c.streaming });
      await r.send({ text: "x", delivery: c.delivery });
      expect({ ...c, steer: r.steer.length, followUp: r.followUp.length, piCalls: r.pi.sendUserMessage.mock.calls.length }).toEqual(c);
    }
  });

  it("E9: an invalid image is dropped at admission and named in feedback; the valid one stays", async () => {
    const r = makeRig({ streaming: () => true });
    await r.send({ text: "look", delivery: "steer", images: [PNG, { type: "image", data: "AAAA", mimeType: "image/tiff" }] });

    expect(r.steer.entries()[0].images).toHaveLength(1);
    expect(r.feedback).toHaveLength(1);
    expect(r.feedback[0].command).toBe("send_prompt");
    expect(r.feedback[0].message).toContain("image/tiff");
  });
});

describe("steer routing (bridge.ts sessionPrompt fallback)", () => {
  /** The fallback is a closure inside the bridge factory; assert its routing shape. */
  function sessionPromptBlock(): string {
    const src = readBridgeSource("bridge.ts");
    const start = src.indexOf("sessionPrompt: async (text, delivery, promptId) => {");
    const end = src.indexOf("onSteerBuffered: bufferSteerSend,", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it("E3: a streaming steer on the slash fallback is buffered with its promptId, never sent to pi", () => {
    const block = sessionPromptBlock();
    expect(block).toMatch(/const bufferSteer = wasStreaming && deliverAs === "steer";/);
    expect(block).toMatch(/else if \(bufferSteer\) \{[^}]*bufferSteerSend\(expanded, undefined, promptId\);/);
    // The steer branch never reaches pi.
    const steerBranch = block.slice(block.indexOf("else if (bufferSteer) {"), block.indexOf("} else {", block.indexOf("else if (bufferSteer) {")));
    expect(steerBranch).not.toMatch(/sendUserMessage/);
    expect(block).toMatch(/promptId && !bufferFollowUp && !bufferSteer/);
  });
});

describe("createSteerBuffer", () => {
  it("E7: the 20th entry is admitted, the 21st refused whole with send_prompt feedback; follow-ups unaffected", () => {
    const steer = createSteerBuffer("n");
    const followUp = createFollowupBuffer();
    followUp.push({ text: "f" });
    const feedback = vi.fn();
    const sinks = { sendCommandFeedback: feedback, emitQueueUpdate: vi.fn() };
    for (let i = 0; i < FOLLOWUP_QUEUE_CAP - 1; i++) admitSteer(steer, { text: `s${i}` }, sinks);
    expect(steer.length).toBe(19);

    expect(admitSteer(steer, { text: "20th" }, sinks)).toBe(true);
    expect(steer.length).toBe(20);
    expect(admitSteer(steer, { text: "21st" }, sinks)).toBe(false);
    expect(steer.length).toBe(20);
    expect(feedback).toHaveBeenCalledWith("send_prompt", expect.stringContaining("20 entries"));
    expect(followUp.length).toBe(1);
  });

  it("E8: an entry of exactly the remaining bytes is admitted; one more byte is refused whole, images kept", () => {
    const max = 1024;
    const steer = createSteerBuffer("n", { maxBytes: max });
    steer.push({ text: "x".repeat(max - 100) });
    const exact = steer.push({ text: "y".repeat(100) });
    expect(exact.ok).toBe(true);

    const tight = createSteerBuffer("n", { maxBytes: max });
    tight.push({ text: "x".repeat(max - 100) });
    const over = tight.push({ text: "y".repeat(97), images: [{ type: "image", data: "abcd", mimeType: "image/png" }] });
    expect(over).toMatchObject({ ok: false, reason: "bytes" });
    expect(over.ok === false && over.message).toContain(`${max} bytes`);
    expect(tight.length).toBe(1);
    expect(tight.totalBytes()).toBe(max - 100);
  });

  it("E10: ids are unique across two bridge instances and strictly ordered within one", () => {
    const a = createSteerBuffer("aaaa");
    const b = createSteerBuffer("bbbb");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      for (const buf of [a, b]) {
        const r = buf.push({ text: "same" });
        if (r.ok) ids.push(r.id);
      }
    }
    expect(new Set(ids).size).toBe(6);
    expect(a.views().map((v) => v.id)).toEqual(["aaaa:1", "aaaa:2", "aaaa:3"]);
  });

  it("take: one-at-a-time takes the oldest, all takes every entry in order; both remove", () => {
    const buf = createSteerBuffer("n");
    for (const t of ["a", "b", "c"]) buf.push({ text: t });
    expect(buf.take("one-at-a-time").map((e) => e.text)).toEqual(["a"]);
    expect(buf.take("all").map((e) => e.text)).toEqual(["b", "c"]);
    expect(buf.length).toBe(0);
    expect(buf.take("all")).toEqual([]);
  });

  it("removeById / clear report whether they mutated", () => {
    const buf = createSteerBuffer("n");
    buf.push({ text: "a" });
    buf.push({ text: "b" });
    expect(buf.removeById("n:2")).toBe(true);
    expect(buf.removeById("n:2")).toBe(false);
    expect(buf.removeById(42 as never)).toBe(false);
    expect(buf.clear()).toBe(true);
    expect(buf.clear()).toBe(false);
  });
});
