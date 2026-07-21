/**
 * Grammar-settings plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest). The shell
 * merges it under `plugin.grammar-settings.*`. Component code resolves keys via
 * the scoped `useT()` hook, which auto-prefixes `plugin.grammar-settings.` and
 * degrades to the call-site English fallback when a key/locale is missing.
 *
 * English is NOT stored here — it lives inline as the `t(key, vars, English)`
 * fallback at each call site (matching roles-plugin / flows-anthropic-bridge).
 * The `hu` catalog below MUST keep key parity with those call sites.
 *
 * See change: add-grammar-settings-plugin.
 */
export const catalog = {
  hu: {
    heading: "Nyelvhelyesség és helyesírás",
    desc: "A szerkesztő nyelvhelyesség-ellenőrzőjének beállításai. Az ellenőrzés a szerveren fut a kiválasztott háttérrel.",
    enabled: "Bekapcsolva",
    autoCheck: "Automatikus ellenőrzés gépelés közben",
    backend: "Háttér",
    backendLanguagetool: "LanguageTool (helyi, offline)",
    backendLlm: "LLM (konfigurált szolgáltató)",
    debounceMs: "Késleltetés (ms)",
    minChars: "Minimum karakterszám",
    maxChars: "Maximum karakterszám",
    language: "Nyelv",
    ltUrl: "LanguageTool szerver URL",
    ltReachable: "elérhető",
    ltUnreachable: "nem érhető el",
    ltTest: "Teszt",
    llmModel: "Modell",
    modelSelectorUnavailable: "A modellválasztó nem érhető el",
    save: "Mentés",
    reload: "Visszatöltés",
    saving: "Mentés…",
    loading: "Betöltés…",
    unsaved: "nincs mentve",
  },
};
