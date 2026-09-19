/**
 * E36 (task 10.36) — render: font subset from merged text.
 *
 * The embedded Poppins subset is computed from the *merged* IR, so a label a
 * caller adds through `overrides` grows the subset and carries its glyphs.
 * Derived text has no `ű`; adding it via `overrides.nodes` must make the second
 * render's subset larger and include the `ű` glyph, while the first does not.
 *
 * L1: no browser — `renderDeck` is called directly with a stub runtime.
 */
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { flowchartIR } from "../../ir/__tests__/fixtures.js";
import { renderDeck } from "../index.js";

const STUB_RUNTIME = "/*runtime*/";

function fontFromHtml(html: string): opentype.Font {
  const encoded = /base64,([A-Za-z0-9+/=]+)\)/.exec(html)?.[1];
  expect(encoded, "embedded base64 font subset missing").toBeTruthy();
  const bytes = Buffer.from(encoded as string, "base64");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return opentype.parse(buffer);
}

/** Number of bytes in the embedded base64 subset (a monotone proxy for size). */
function subsetLength(html: string): number {
  return (/base64,([A-Za-z0-9+/=]+)\)/.exec(html)?.[1] ?? "").length;
}

describe("E36 font subset from merged text", () => {
  it("grows the subset and adds the override glyph", () => {
    const ir = flowchartIR();
    // Derived labels: `Alpha`, `Beta` — no `ű`.
    const before = renderDeck(ir, { runtime: STUB_RUNTIME });
    expect(fontFromHtml(before).charToGlyph("ű").index).toBe(0);

    ir.overrides.nodes = { "intro/A": { label: "űrhajó" } };
    const after = renderDeck(ir, { runtime: STUB_RUNTIME });

    expect(fontFromHtml(after).charToGlyph("ű").index).toBeGreaterThan(0);
    expect(subsetLength(after)).toBeGreaterThan(subsetLength(before));
  });
});
