import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toneAttr, toneIconClass, toneRowClass } from "../tone.js";

const HUE = { go: "green", create: "blue", caution: "orange", danger: "red" } as const;
const INVALID = ["purple", "", "Danger", "constructor", "__proto__", "toString", 42, null, undefined, {}];

/**
 * @structural-pin Tailwind only generates classes it sees as complete literals; interpolating a tone would silently drop them and let an untrusted value build a class.
 */
describe("tone helpers (test-plan #E2)", () => {
  for (const [tone, hue] of Object.entries(HUE)) {
    it(`${tone}: icon class when enabled, none when disabled`, () => {
      expect(toneIconClass(tone, { disabled: false })).toBe(`text-[var(--accent-${hue}-text)]`);
      expect(toneIconClass(tone, { disabled: true })).toBe("");
      expect(toneRowClass(tone, { disabled: true })).toBe("");
      expect(toneAttr(tone)).toBe(tone);
    });
  }
  it("only enabled danger gets a row class", () => {
    expect(toneRowClass("danger", { disabled: false })).toContain("hover:bg-[var(--tint-red-bg)]");
    expect(toneRowClass("danger", { disabled: false })).toContain("focus:text-[var(--accent-red-text)]");
    for (const t of ["go", "create", "caution"]) expect(toneRowClass(t, { disabled: false })).toBe("");
  });
  it("invalid values yield neutral output", () => {
    for (const v of INVALID) {
      expect(toneIconClass(v, { disabled: false })).toBe("");
      expect(toneRowClass(v, { disabled: false })).toBe("");
      expect(toneAttr(v)).toBeUndefined();
    }
  });
  it("maps hold literals only, no interpolation (#E3)", () => {
    const src = readFileSync(join(__dirname, "../tone.ts"), "utf8");
    expect(src).not.toMatch(/`[^`]*\$\{[^}]*tone/);
    for (const hue of Object.values(HUE)) expect(src).toContain(`text-[var(--accent-${hue}-text)]`);
  });
});
