/**
 * Catalog key-parity for the craft-web plugin: `EN` (call-site English) ↔ zh-CN ↔ hu, with
 * {var} placeholders preserved. A missing key silently falls back to English.
 * See change: edit-office-in-pane-with-craft-web.
 */
import { describe, expect, it } from "vitest";
import { catalog } from "../../i18n.js";
import { EN, formatSize } from "../messages.js";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("craft-web i18n", () => {
  const keys = Object.keys(EN).sort();
  for (const lang of ["zh-CN", "hu"] as const) {
    it(`${lang} has exactly the EN key set with the same placeholders`, () => {
      const c = catalog[lang] as Record<string, string>;
      expect(Object.keys(c).sort()).toEqual(keys);
      for (const k of keys) expect(vars(c[k]), `${lang}.${k}`).toEqual(vars(EN[k as keyof typeof EN]));
    });
  }

  it("formatSize", () => {
    expect(formatSize(undefined)).toBeNull();
    expect(formatSize(0)).toBeNull();
    expect(formatSize(300)).toBe("1 KB");
    expect(formatSize(16_580_000)).toBe("15.8 MB");
  });
});
