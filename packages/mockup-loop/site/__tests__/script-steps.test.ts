// @vitest-environment jsdom
/**
 * L1 — runSteps `from` + `paused(k)` (completed-step count; skipped steps count).
 * See change: mock-player-step-controls (test-plan E11).
 */
import { describe, expect, it } from "vitest";
import { runSteps, type ScriptStep } from "../script.ts";

// jsdom has no CSS.escape (the runner uses it for test ids).
globalThis.CSS ??= { escape: (v: string) => v } as typeof CSS;

describe("runSteps from + paused(k) (E11)", () => {
  it("starts after `from` steps and reports k before each considered step", async () => {
    document.body.innerHTML = `<button data-testid="b1">1</button><button data-testid="b3">3</button><button data-testid="b4">4</button><span data-testid="done"></span>`;
    const clicks: string[] = [];
    for (const b of Array.from(document.querySelectorAll("button"))) b.addEventListener("click", () => clicks.push(b.dataset.testid!));
    const steps: ScriptStep[] = [
      { say: "one", target: "b1", act: "click" },
      { say: "two", target: "missing", act: "click", unless: "done" },
      { say: "three", target: "b3", act: "click" },
      { say: "four", target: "b4", act: "click" },
    ];
    const ks: number[] = [];
    const r = await runSteps(document, steps, { from: 1, fast: true, paused: async (k) => { ks.push(k); } });
    expect(r).toEqual({ ok: true });
    expect(ks).toEqual([1, 2, 3]);
    expect(clicks).toEqual(["b3", "b4"]);
  });
});
