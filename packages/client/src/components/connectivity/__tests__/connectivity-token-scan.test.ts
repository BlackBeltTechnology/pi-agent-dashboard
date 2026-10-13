/**
 * The identity + connectivity surfaces paint only through theme tokens and
 * semantic families — no Tailwind palette class, hex or `rgba(` literal
 * (`ui-contract.md` § Colour roles). One documented exception: the invite QR's
 * light quiet zone (`bg-white`, ISO/IEC 18004 §6.3.8) in `UsersSection.tsx`.
 *
 * `scripts/theme-token-guard.mjs` does not check palette classes, so this scan
 * is the only gate keeping these files on tokens.
 *
 * See change: retro-ux-identity-connectivity (test-plan #E15).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..");
const FILES = [
  "UsersSection.tsx",
  "PasskeyImpactNote.tsx",
  "ServerSelector.tsx",
  "KnownServersSection.tsx",
  "NetworkDiscoverySection.tsx",
  "connectivity-ui.ts",
];

const PALETTE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:red|green|blue|yellow|amber|gray|slate|zinc|neutral|stone|emerald|orange|purple|indigo|sky|teal|cyan|lime|pink|rose|violet|fuchsia)-\d+/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA = /rgba?\(/g;

/** Drop comments so prose such as "(ISO/IEC 18004 §6.3.8)" or "#867" cannot match. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("connectivity components use tokens only (E15)", () => {
  it.each(FILES)("%s has no palette class, hex or rgba literal", (file) => {
    const src = code(readFileSync(join(DIR, file), "utf8"));
    const hits = [...src.matchAll(PALETTE), ...src.matchAll(HEX), ...src.matchAll(RGBA)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });

  it("bg-white appears only on the invite QR in UsersSection.tsx", () => {
    for (const file of FILES) {
      const n = (code(readFileSync(join(DIR, file), "utf8")).match(/\bbg-white\b/g) ?? []).length;
      expect(n, file).toBe(file === "UsersSection.tsx" ? 1 : 0);
    }
  });
});
