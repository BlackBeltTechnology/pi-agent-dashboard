/**
 * The missing-folder pill strings are updated IN PLACE (no new keys): label
 * `common.cwdGone` and tooltip `folders.sessionSDirectoryNoLongerExists`, in
 * en / hu / zh-CN, each key defined exactly once per catalog.
 * See change: compact-session-card-header (test-plan E15, design D6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = join(__dirname, "..", "lib");
const read = (rel: string) => readFileSync(join(LIB, rel), "utf8");

const EXPECTED = {
  "common.cwdGone": { en: "folder missing", hu: "a mappa hiányzik", zh: "文件夹缺失" },
  "folders.sessionSDirectoryNoLongerExists": {
    en: "This session's folder no longer exists",
    hu: "A munkamenet mappája már nem létezik",
    zh: "此会话的文件夹已不存在",
  },
} as const;

const FILES = { en: "i18n-en-source.json", hu: "i18n/i18n-hu.ts", zh: "i18n/i18n-zh-CN.ts" } as const;

describe("folder-missing i18n strings", () => {
  for (const [lang, file] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const src = read(file);
    for (const [key, values] of Object.entries(EXPECTED)) {
      it(`${lang}: ${key} is defined once with the new value`, () => {
        const occurrences = src.split(`"${key}":`).length - 1;
        expect(occurrences).toBe(1);
        expect(src).toContain(`"${key}": ${JSON.stringify(values[lang])}`);
      });
    }
  }
});
