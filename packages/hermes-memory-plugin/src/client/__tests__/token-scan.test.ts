/**
 * The hermes-memory settings section paints only through theme tokens: no
 * `--accent-*` text colour, no Tailwind palette class, hex or `rgba(` literal
 * (`ui-contract.md` § Colour roles). `scripts/theme-token-guard.mjs` does not
 * scan this tree, so this test is the gate (test-plan #E16).
 *
 * See change: retro-ux-plugin-settings-forms.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:red|green|blue|yellow|amber|gray|slate|zinc|neutral|stone|emerald|orange|purple|indigo|sky|teal|cyan|lime|pink|rose|violet|fuchsia)-\d+/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const ACCENT_TEXT = /(?:text-\[var\(--accent-|color:\s*var\(--accent-|text-\[color:var\(--accent-)/g;

/** Drop comments so prose cannot match. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("HermesMemorySettings uses tokens only and the strict primitive lookup (E16)", () => {
  const src = code(readFileSync(join(import.meta.dirname, "..", "HermesMemorySettings.tsx"), "utf8"));
  it("has no --accent-* text paint", () => expect(src.match(ACCENT_TEXT) ?? []).toEqual([]));
  it("has no palette class, hex or rgba literal", () => {
    expect([...src.matchAll(PALETTE), ...src.matchAll(HEX)].map((m) => m[0])).toEqual([]);
    expect(src).not.toContain("rgba(");
  });

  it("looks the model selector up with the strict hook only", () => {
    expect(src).toMatch(/useUiPrimitive\(UI_PRIMITIVE_KEYS\.modelSelector\)/);
    expect(src).not.toContain("useUiPrimitiveOrNull");
  });
});
