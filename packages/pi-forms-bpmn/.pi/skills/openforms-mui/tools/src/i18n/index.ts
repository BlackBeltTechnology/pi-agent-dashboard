/**
 * Translation resolution: the schema's `translations` dictionary localizes
 * author content (resolved by locale then key, falling back to the schema's base
 * text when a key is absent); the built-in UI dictionaries localize the
 * component's own chrome. Structural values (keys, operators, formulas) are
 * never translated.
 */
import type { TranslationsDictionary } from "../schema/types.js";
import { en, type UiDictionary } from "./dictionary.js";
import { hu } from "./hu.js";

export type { UiDictionary } from "./dictionary.js";
export { en } from "./dictionary.js";
export { hu, formatHuf, HU_DATE_DISPLAY_FORMAT, HU_MASKS } from "./hu.js";

const UI_DICTIONARIES: Record<string, UiDictionary> = { en, hu };

export interface Translator {
  /** A UI-chrome string in the active locale (falls back to English). */
  ui: UiDictionary;
  /** Locale code in effect. */
  locale: string;
  /**
   * Resolve author-supplied display text. Looks up
   * `translations[locale][key]`, else returns the schema's base text.
   */
  text(baseText: string | undefined, key?: string): string;
}

export function createTranslator(
  translations: TranslationsDictionary | undefined,
  locale: string,
): Translator {
  const ui = UI_DICTIONARIES[locale] ?? en;
  return {
    ui,
    locale,
    text(baseText, key) {
      if (key && translations?.[locale]?.[key] !== undefined) return translations[locale][key];
      return baseText ?? "";
    },
  };
}
