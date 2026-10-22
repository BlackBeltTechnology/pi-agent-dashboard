/**
 * The five keys added by polish-sidebar-header-controls exist, non-empty, in
 * the en source and the zh-CN / hu catalogs (test-plan #E18).
 * See change: polish-sidebar-header-controls.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = join(__dirname, "..", "lib");
const read = (rel: string) => readFileSync(join(LIB, rel), "utf8");

const KEYS = [
  "common.appearancePalette",
  "common.themeLight",
  "common.themeSystem",
  "common.themeDark",
  "connection.switchServerNamed",
] as const;
const FILES = { en: "i18n-en-source.json", "zh-CN": "i18n/i18n-zh-CN.ts", hu: "i18n/i18n-hu.ts" } as const;

describe("polish-sidebar-header-controls i18n keys", () => {
  for (const [lang, file] of Object.entries(FILES)) {
    const src = read(file);
    for (const key of KEYS) {
      it(`${lang}: ${key} is present and non-empty`, () => {
        const m = src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]+)"`));
        expect(m?.[1]?.length ?? 0).toBeGreaterThan(0);
      });
    }
  }
});
