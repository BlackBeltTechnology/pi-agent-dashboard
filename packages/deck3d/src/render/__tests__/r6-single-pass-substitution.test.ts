/**
 * R6 — template substitution is a single pass over the original template, so a
 * value that itself contains a later token is never rescanned. Before the fix
 * `__DECK__`/`__FONT__`/… were replaced sequentially: a title documenting the
 * `__FONT__` placeholder would have had that literal overwritten by the font
 * payload. Determinism is unchanged (covered by P3).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeckIR } from "../../ir/types.js";
import { renderDeck } from "../index.js";

const IR = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8")) as DeckIR;
const TEMPLATE = "<title>__TITLE__</title>|__DECK__|__DECK_PROPS__|__FONT__|__RUNTIME__";

describe("R6 template substitution is one pass", () => {
  it("never rescans a substituted value for a later token", () => {
    const title = "deck3d template docs: __FONT__ and __RUNTIME__";
    const html = renderDeck(IR, { template: TEMPLATE, runtime: "RUNTIME", font: "FONT", title });
    // The title's own tokens survive verbatim …
    expect(html).toContain(`<title>${title}</title>`);
    // … while the template's tokens are still the only ones replaced.
    expect(html).toContain("|{}|FONT|RUNTIME");
  });

  it("stays byte-deterministic for the same inputs", () => {
    const opts = { template: TEMPLATE, runtime: "RUNTIME", font: "FONT", title: "t __TITLE__" };
    expect(renderDeck(IR, opts)).toBe(renderDeck(IR, opts));
    expect(renderDeck(IR, opts)).toContain("<title>t __TITLE__</title>");
  });
});
