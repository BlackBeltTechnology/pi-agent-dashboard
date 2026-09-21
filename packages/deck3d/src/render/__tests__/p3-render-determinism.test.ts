/**
 * P3 (task 10.50) — render: render is deterministic and fast.
 *
 * The same `deck.json` rendered three times in-process must produce byte-identical
 * HTML, each call under 5 s. `renderDeck` is pure (fixed runtime, sorted IR,
 * clock-frozen font subset) and needs no browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeckIR } from "../../ir/types.js";
import { ensureRuntime, renderDeck } from "../index.js";

const IR = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8")) as DeckIR;

describe("P3 render is deterministic and fast", () => {
  it("three renders are byte-identical and each under 5 s", async () => {
    const runtime = await ensureRuntime();
    const htmls: string[] = [];
    const durations: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      htmls.push(renderDeck(IR, { runtime }));
      durations.push(performance.now() - start);
    }
    expect(htmls[0]).toBe(htmls[1]);
    expect(htmls[1]).toBe(htmls[2]);
    for (const [i, ms] of durations.entries()) expect(ms, `render ${i}`).toBeLessThan(5000);
  }, 60_000);
});
