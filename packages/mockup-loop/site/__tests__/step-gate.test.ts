/**
 * L1 — step gate state machine (pause / hidden / step forward / step back).
 * See change: mock-player-step-controls (test-plan E1-E10).
 */
import { describe, expect, it, vi } from "vitest";
import { createStepGate, Rewind, type StepGateOptions } from "../step-gate.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Settled state of a promise: "pending", "resolved" or the rejection. */
async function settled(p: Promise<unknown>): Promise<unknown> {
  let out: unknown = "pending";
  p.then(() => { out = "resolved"; }, (e) => { out = e; });
  await tick();
  return out;
}
const gateOf = (o: Partial<StepGateOptions> = {}) => {
  const onHeld = vi.fn();
  const g = createStepGate({ steps: 3, loop: true, onHeld, ...o });
  return { g, onHeld };
};
/** Paused gate resting at held(k). */
const heldAt = (k: number, o: Partial<StepGateOptions> = {}) => {
  const { g, onHeld } = gateOf(o);
  g.setPaused(true);
  const w = g.wait(k);
  return { g, w, onHeld };
};

describe("step gate", () => {
  it("held(1) · Forward → step 2 released once: running(1,0), then held(2) (E1)", async () => {
    const { g, w } = heldAt(1);
    expect(g.state).toEqual({ kind: "held", k: 1 });
    g.step(1);
    expect(await settled(w)).toBe("resolved");
    expect(g.state).toEqual({ kind: "running", k: 1, q: 0 });
    expect(g.view).toBe("busy");
    const w2 = g.wait(2);
    expect(await settled(w2)).toBe("pending");
    expect(g.state).toEqual({ kind: "held", k: 2 });
  });

  it("held(3) · Forward → looping releases the next loop then held(0); one-shot no-op (E2)", async () => {
    const loop = heldAt(3);
    loop.g.step(1);
    expect(await settled(loop.w)).toBe("resolved"); // runtime remounts
    const w0 = loop.g.wait(0);
    expect(await settled(w0)).toBe("pending");
    expect(loop.g.state).toEqual({ kind: "held", k: 0 });

    const onChange = vi.fn();
    const once = heldAt(3, { loop: false, onChange });
    onChange.mockClear();
    once.g.step(1);
    expect(await settled(once.w)).toBe("pending");
    expect(once.g.state).toEqual({ kind: "held", k: 3 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("held(0) · Back → Rewind(0) (E3)", async () => {
    const { g, w } = heldAt(0);
    g.step(-1);
    const r = await settled(w);
    expect(r).toBeInstanceOf(Rewind);
    expect((r as Rewind).to).toBe(0);
    expect(g.state).toEqual({ kind: "rewinding" });
  });

  it("held(1) / held(3) · Back → Rewind(0) / Rewind(2) (E4)", async () => {
    for (const [k, to] of [[1, 0], [3, 2]]) {
      const { g, w } = heldAt(k);
      g.step(-1);
      expect(((await settled(w)) as Rewind).to).toBe(to);
    }
  });

  it("running(1,0) · Forward ×1/×2/×3 → q = 1; exactly one extra step, then held(3) (E5)", async () => {
    for (const presses of [1, 2, 3]) {
      const { g, w } = heldAt(1);
      g.step(1);
      await settled(w);
      for (let i = 0; i < presses; i++) g.step(1);
      expect(g.state).toEqual({ kind: "running", k: 1, q: 1 });
      expect(await settled(g.wait(2))).toBe("resolved"); // the queued step 3
      expect(g.state).toEqual({ kind: "running", k: 2, q: 0 });
      expect(await settled(g.wait(3))).toBe("pending");
      expect(g.state).toEqual({ kind: "held", k: 3 });
    }
  });

  it("running(1,1) · Back then step 2 ends → queue cleared, Rewind(1) (E6)", async () => {
    const { g, w } = heldAt(1);
    g.step(1);
    await settled(w);
    g.step(1);
    g.step(-1);
    expect(g.state).toEqual({ kind: "running", k: 1, q: 0 });
    const r = await settled(g.wait(2));
    expect(r).toBeInstanceOf(Rewind);
    expect((r as Rewind).to).toBe(1);
  });

  it("playing / rewinding / stopped · Forward and Back → dropped (E7)", async () => {
    const playing = gateOf().g;
    await settled(playing.wait(1));
    const rewinding = heldAt(2);
    rewinding.g.step(-1);
    await settled(rewinding.w);
    const stopped = gateOf().g;
    stopped.stop();
    for (const g of [playing, rewinding.g, stopped]) {
      const before = g.state;
      g.step(1);
      g.step(-1);
      expect(g.state).toEqual(before);
    }
    expect(playing.state).toEqual({ kind: "playing" });
    expect(rewinding.g.state).toEqual({ kind: "rewinding" });
    expect(stopped.state).toEqual({ kind: "stopped" });
  });

  it("held(1) while hidden · Forward → released only when visible (E8)", async () => {
    const { g } = gateOf();
    g.setPaused(true);
    g.setHidden(true);
    const w = g.wait(1);
    g.step(1);
    expect(await settled(w)).toBe("pending");
    g.setHidden(false);
    expect(await settled(w)).toBe("resolved");
    expect(g.state).toEqual({ kind: "running", k: 1, q: 0 });
  });

  it("running(1,1) with a pending Back · Unpause → playing, no Rewind, no extra release (E9)", async () => {
    const { g, w } = heldAt(1);
    g.step(1);
    await settled(w);
    g.step(1);
    g.step(-1);
    g.setPaused(false);
    expect(g.state).toEqual({ kind: "playing" });
    expect(await settled(g.wait(2))).toBe("resolved");
    expect(g.state).toEqual({ kind: "playing" });
  });

  it("onHeld reports the resting index (E10)", async () => {
    const { g, w, onHeld } = heldAt(0);
    g.step(1);
    await settled(w);
    g.step(1); // queue step 2
    await settled(g.wait(1));
    void g.wait(2);
    expect(onHeld.mock.calls).toEqual([[0], [2]]);
  });
});
