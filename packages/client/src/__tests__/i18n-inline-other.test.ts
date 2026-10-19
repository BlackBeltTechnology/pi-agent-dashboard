/**
 * Inline "Other" strings are defined exactly once per catalog (en / hu / zh-CN),
 * so the new component carries no hardcoded English. Test-plan #F10.
 * See change: add-ask-user-inline-other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = join(__dirname, "..", "lib");
const read = (rel: string) => readFileSync(join(LIB, rel), "utf8");

const EXPECTED = {
  "common.other": { en: "Other", hu: "Egyéb", zh: "其他" },
  "common.otherAnswer": { en: "Other answer", hu: "Egyéb válasz", zh: "其他答案" },
  "common.otherPlaceholder": { en: "Type your answer", hu: "Írd be a válaszod", zh: "输入你的答案" },
} as const;

const FILES = { en: "i18n-en-source.json", hu: "i18n/i18n-hu.ts", zh: "i18n/i18n-zh-CN.ts" } as const;

describe("inline Other i18n strings", () => {
  for (const [lang, file] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const src = read(file);
    for (const [key, values] of Object.entries(EXPECTED)) {
      it(`${lang}: ${key} is defined once`, () => {
        expect(src.split(`"${key}":`).length - 1).toBe(1);
        expect(src).toContain(`"${key}": ${JSON.stringify(values[lang])}`);
      });
    }
  }
});
