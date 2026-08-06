import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Units moved out of the label text into the `unit` chip (design D5). The
// zh-CN and hu dictionaries embedded the unit in the *translated* string, so
// stripping only the English fallback would leave those locales rendering the
// unit twice — once in the label, once in the chip. C1 resolved this as
// "update the existing keys in place across en / zh-CN / hu".
//
// The zh-CN catalog is module-private inside i18n.tsx, so this reads the
// dictionary sources as text rather than widening their exports — the same
// approach themes.test.ts takes against index.css.
// See change: reorganize-settings-pages-and-descriptions. test-plan #E14.

const here = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(here, "../../../lib");

const SOURCES: [string, string][] = [
  ["zh-CN", readFileSync(resolve(LIB, "i18n/i18n.tsx"), "utf8")],
  ["hu", readFileSync(resolve(LIB, "i18n/i18n-hu.ts"), "utf8")],
  ["en", readFileSync(resolve(LIB, "i18n-en-source.json"), "utf8")],
];

/** Keys whose label used to carry a unit or range parenthetical. */
const UNIT_BEARING_KEYS = [
  "settings.probeInterval",
  "settings.probeTimeout",
  "settings.pollIntervalSeconds53600",
  "settings.jitterSeconds060",
  "session.askUserPromptTimeoutSeconds",
  "session.maxConcurrentSessions116",
  "settings.maxStringTruncationChars",
  "settings.maxWebsocketBufferBytes",
  "settings.reasoningAutoCollapse",
];

/** Unit tokens that must no longer appear in a label, in any locale. */
const UNIT_TOKENS = [
  "second", "másodperc", "秒",
  "char", "karakter", "字符",
  "byte", "bájt", "字节",
];

function lookup(source: string, key: string): string | undefined {
  const m = source.match(new RegExp(`"${key.replace(".", "\\.")}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m?.[1];
}

/**
 * A unit token only counts when it stands alone — not when it is a syllable of
 * a longer word. Hungarian "karakterlánc" (character *string*) legitimately
 * contains "karakter"; that is the noun, not a dangling unit.
 */
function containsStandaloneToken(value: string, token: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${token}([^\\p{L}]|$)`, "iu").test(value);
}

describe("unit-bearing i18n keys (D5 / C1)", () => {
  it("finds every key in at least one catalog (guards a typo'd key list)", () => {
    for (const key of UNIT_BEARING_KEYS) {
      const found = SOURCES.some(([, src]) => lookup(src, key) !== undefined);
      expect(found, `${key} not present in any catalog`).toBe(true);
    }
  });

  for (const key of UNIT_BEARING_KEYS) {
    it(`${key} carries no unit or range parenthetical in any locale`, () => {
      for (const [locale, source] of SOURCES) {
        const value = lookup(source, key);
        if (value === undefined) continue; // locale ships no translation for it

        // The unit/range lived in a trailing parenthetical — ASCII or full-width.
        expect(value, `${locale}:${key} -> "${value}"`).not.toMatch(/[（(][^（()）]*[)）]\s*$/u);

        for (const token of UNIT_TOKENS) {
          expect(
            containsStandaloneToken(value, token),
            `${locale}:${key} still contains unit token "${token}" -> "${value}"`,
          ).toBe(false);
        }
      }
    });
  }
});
