// @vitest-environment jsdom
/**
 * L1 — the pane loop's rewind path: only `Rewind` replays; any other throw is a counted
 * failure; a failing replay stops the gate and counts once.
 * See change: mock-player-step-controls (test-plan E16, X2).
 */
import { describe, expect, it, vi } from "vitest";
import { type Health, type LoopContext, playLoop } from "../pane-runtime.ts";
import type { ScriptStep } from "../script.ts";
import { Rewind } from "../step-gate.ts";

// jsdom has no CSS.escape (the runner uses it for test ids).
globalThis.CSS ??= { escape: (v: string) => v } as typeof CSS;

const steps: ScriptStep[] = [
  { say: "one", target: "s1", act: "click", timeout: 200 },
  { say: "two", target: "s2", act: "click", timeout: 200 },
  { say: "three", target: "s3", act: "click", timeout: 200 },
];
const mount = () => { document.body.innerHTML = `<button data-testid="s1"></button><button data-testid="s2"></button><button data-testid="s3"></button>`; };

function ctx(wait: (k: number) => Promise<void>, reset: () => Promise<void>) {
  const health: Health = { completed: 0, failed: 0, errors: [] };
  const c: LoopContext = {
    spec: "m/1/proposed", n: 1, gate: { wait: vi.fn(wait), stop: vi.fn() }, overlay: null, fast: true, hold: false,
    stopOnFail: true, reset: vi.fn(reset), health, post: vi.fn(),
  };
  return c;
}

describe("playLoop rewind handling", () => {
  it("Rewind → remount + replay, continue from the landing step; Error → counted failure (E16)", async () => {
    mount();
    let thrown = false;
    const rw = ctx(async (k) => { if (k === 2 && !thrown) { thrown = true; throw new Rewind(1); } }, async () => mount());
    expect(await playLoop(document, steps, rw)).toEqual({ ok: true });
    expect(rw.reset).toHaveBeenCalledTimes(1);
    expect((rw.gate.wait as ReturnType<typeof vi.fn>).mock.calls.map((a) => a[0])).toEqual([0, 1, 2, 1, 2, 3]);
    expect(rw.health).toMatchObject({ completed: 1, failed: 0 });

    mount();
    const err = ctx(async (k) => { if (k === 1) throw new Error("boom"); }, async () => mount());
    expect(await playLoop(document, steps, err)).toEqual({ ok: false, error: "boom" });
    expect(err.reset).not.toHaveBeenCalled();
    expect(err.health).toMatchObject({ completed: 0, failed: 1 });
    expect(err.gate.stop).toHaveBeenCalledTimes(1);
  });

  it("a failing replay stops the gate, counts one failed loop, posts mkHealth once (X2)", async () => {
    mount();
    const c = ctx(async (k) => { if (k === 2) throw new Rewind(1); }, async () => { document.body.innerHTML = ""; });
    const r = await playLoop(document, steps, c);
    expect(r.ok).toBe(false);
    expect(c.gate.stop).toHaveBeenCalledTimes(1);
    expect(c.health).toMatchObject({ completed: 0, failed: 1 });
    expect(c.post).toHaveBeenCalledTimes(1);
    expect(c.post).toHaveBeenCalledWith(expect.objectContaining({ mkHealth: "m/1/proposed", failed: 1 }));
  });
});
