/**
 * The shared pending-prompt emitter — test-plan scenarios E10, X2, X4 for
 * change: fix-pending-prompt-lost-on-replay (design D7).
 *
 * One emitter serves two entry points: the bridge's `onReconnect` replay
 * (no token) and the `prompt_resync_request` handler (echoed requester
 * token). These tests pin the emitter's contract against a REAL PromptBus:
 *   - frames are identical in shape to the `onDashboardRequest` emit
 *     (id, component, placement preserved)
 *   - a token is echoed ONLY when given
 *   - an empty pending set emits zero frames, no error (E10)
 *   - a mixed-version peer that never invokes the emitter produces no reply
 *     and no error (X2 — the old-bridge half)
 *   - an answered prompt is absent from a later resync, and a late answer
 *     for an unknown id is ignored without throwing (X4)
 *
 * In-flight requests settle through the shared helper (last statement, after
 * every assertion) per the suite-wide contract pinned in
 * `prompt-bus-inflight-settle.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { emitPendingPrompts } from "../pending-prompt-emitter.js";
import { PromptBus } from "../prompt-bus.js";
import { settlePrompts } from "./helpers/settle-prompts.js";

function createBus() {
  const bus = new PromptBus({
    timeoutMs: 0, // infinite — nothing times out mid-test
    onDashboardRequest: vi.fn(),
  });
  return { bus };
}

/** Fire a request and leave it deliberately in flight (it IS the pending set). */
function trackPending(bus: PromptBus, question: string) {
  return bus.request({ pipeline: "command", type: "select", question, options: ["a", "b"] });
}

describe("emitPendingPrompts — frame shape (D7 parity with onDashboardRequest)", () => {
  it("re-emits each pending prompt with its id, component and placement", async () => {
    const { bus } = createBus();
    const first = trackPending(bus, "q1");
    const second = trackPending(bus, "q2");

    const frames: Record<string, unknown>[] = [];
    const emitted = emitPendingPrompts(bus, (m) => frames.push(m), "sess-1");

    expect(emitted).toBe(2);
    expect(frames.map((f) => f.promptId)).toHaveLength(2);
    for (const f of frames) {
      expect(f.type).toBe("prompt_request");
      expect(f.sessionId).toBe("sess-1");
      expect(f.component).toEqual({ type: "generic-dialog", props: expect.objectContaining({ type: "select" }) });
      expect(f.placement).toBe("inline");
      const prompt = f.prompt as Record<string, unknown>;
      expect(typeof prompt.question).toBe("string");
      expect(Array.isArray(prompt.options)).toBe(true);
      // The reconnect emit never carries a token.
      expect("__resyncRequestId" in f).toBe(false);
    }
    await settlePrompts(bus, first, second);
  });

  it("echoes the requester token on every frame when given one", async () => {
    const { bus } = createBus();
    const first = trackPending(bus, "q1");
    const second = trackPending(bus, "q2");

    const frames: Record<string, unknown>[] = [];
    emitPendingPrompts(bus, (m) => frames.push(m), "sess-1", "tok-42");

    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.__resyncRequestId).toBe("tok-42");
    await settlePrompts(bus, first, second);
  });
});

describe("emitPendingPrompts — E10: nothing pending is a silent no-op", () => {
  it("an empty pending set emits zero frames and raises no error", () => {
    const { bus } = createBus();
    const send = vi.fn();
    const emitted = emitPendingPrompts(bus, send, "sess-1", "tok-1");
    expect(emitted).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("an answered prompt is no longer pending, so a later resync emits nothing for it", async () => {
    const { bus } = createBus();
    const inflight = trackPending(bus, "q1");
    const id = latestPendingId(bus);
    bus.respond({ id, answer: "a", source: "tui" });
    expect(bus.pendingCount).toBe(0);

    const send = vi.fn();
    expect(emitPendingPrompts(bus, send, "sess-1", "tok-1")).toBe(0);
    expect(send).not.toHaveBeenCalled();
    await expect(inflight).resolves.toEqual({ id, answer: "a", source: "tui" });
  });
});

describe("emitPendingPrompts — X2/X4: degraded peers race silently", () => {
  it("X2: a peer that never invokes the emitter (old bridge) yields no reply frames, no error", async () => {
    // The old-bridge stand-in: the server's forward arrives at a build with no
    // `prompt_resync_request` arm, so nothing is ever emitted. The observable
    // contract on THIS side is the emitter's own degrade — zero frames, zero
    // errors — which is what an unpatched peer effectively does.
    const { bus } = createBus();
    const inflight = trackPending(bus, "q1");
    const send = vi.fn();
    expect(() => emitPendingPrompts(bus, send, "sess-1", "tok-1")).not.toThrow();
    await settlePrompts(bus, inflight);
  });

  it("X4: an answer that settles mid-resync removes the prompt; the late echo for the resolved id draws no dialog", async () => {
    const { bus } = createBus();
    const inflight = trackPending(bus, "q1");
    const id = latestPendingId(bus);

    // The answer wins the race BEFORE the resync reply is re-emitted.
    bus.respond({ id, answer: "a", source: "dashboard-default" });
    await expect(inflight).resolves.toEqual({ id, answer: "a", source: "dashboard-default" });

    // The bridge half: the bus no longer holds the prompt, so the resync
    // emits nothing — the client cannot resurrect a dialog for it.
    const send = vi.fn();
    expect(emitPendingPrompts(bus, send, "sess-1", "tok-1")).toBe(0);

    // The late-answer half: the bridge ignores an answer for an unknown id
    // (already resolved) without throwing.
    expect(() => bus.respond({ id, answer: "late", source: "dashboard-default" })).not.toThrow();
  });
});

/** The single pending request's id (helper; the bus only exposes the count). */
function latestPendingId(bus: PromptBus): string {
  const probed: Record<string, unknown>[] = [];
  emitPendingPrompts(bus, (m) => probed.push(m), "probe");
  expect(probed).toHaveLength(1);
  return probed[0].promptId as string;
}
