/**
 * P2 (task 10.49) — render: build budget (size).
 *
 * The fixture deck's `deck.html` must stay ≤ 2,621,440 bytes (2.5 MiB). Rendering
 * the committed `fixtures/strategy-lab.json` is byte-equivalent to building
 * `fixtures/strategy-lab.md`, and needs no browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeckIR } from "../../ir/types.js";
import { ensureRuntime, renderDeck } from "../index.js";

const MAX_DECK_BYTES = 2_621_440;

const IR = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8")) as DeckIR;

describe("P2 fixture deck size budget", () => {
  it("deck.html stays within 2,621,440 bytes", async () => {
    const html = renderDeck(IR, { runtime: await ensureRuntime() });
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(MAX_DECK_BYTES);
  }, 60_000);
});
