/**
 * Grammar-settings plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest). The shell
 * merges it under `plugin.grammar.*`. Component code resolves keys via
 * the scoped `useT()` hook, which auto-prefixes `plugin.grammar.` and
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
    desc: "A szerkesztő nyelvhelyesség-ellenőrzőjének beállításai. Az ellenőrzés a szerveren fut a beállított LLM modellel.",
    enabled: "Bekapcsolva",
    autoCheck: "Automatikus ellenőrzés gépelés közben",
    correctionView: "Javítás nézet",
    correctionViewRedline: "Korrektúra (soron belül)",
    correctionViewList: "Lista",
    modeRedline: "Korrektúra",
    modeCompact: "Kompakt",
    modeOriginal: "Eredeti",
    modeCorrected: "Javított",
    apply: "Alkalmaz",
    ignore: "Elvet",
    capitalizeFirstWord: "Mondatkezdő nagybetűsítés",
    debounceMs: "Késleltetés (ms)",
    minChars: "Minimum karakterszám",
    maxChars: "Maximum karakterszám",
    language: "Nyelv",
    llmModel: "Modell",
    modelHint: "A modell választása befolyásolja a minőséget, a késleltetést és a költséget.",
    modelHintLink: "Mely modellek jók?",
    modelRequired: "Válassz modellt – a nyelvtani ellenőrzés csak beállított modellel fut.",
    modelSelectorUnavailable: "A modellválasztó nem érhető el",
    save: "Mentés",
    reload: "Visszatöltés",
    saving: "Mentés…",
    loading: "Betöltés…",
    unsaved: "nincs mentve",
  },
};
