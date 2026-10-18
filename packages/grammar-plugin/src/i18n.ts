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
    desc: "Nyelvhelyesség- és helyesírás-ellenőrzés az üzenetszerkesztőhöz.",
    enabled: "Nyelvhelyesség ellenőrzése a szerkesztőben",
    enabledHint: "Aláhúzza a hibákat az üzenetmezőben. Az ellenőrzés a szerveren fut az alábbi modellel.",
    autoCheck: "Ellenőrzés gépelés közben",
    autoCheckHint: "Kikapcsolva csak kérésre ellenőriz.",
    correctionView: "Javítások megjelenítése",
    correctionViewHint: "A korrektúra soron belül jelöli a változtatásokat; a lista a mező alatt mutatja őket.",
    correctionViewRedline: "Korrektúra (soron belül)",
    correctionViewList: "Lista",
    modeRedline: "Korrektúra",
    modeCompact: "Kompakt",
    modeOriginal: "Eredeti",
    modeCorrected: "Javított",
    apply: "Alkalmaz",
    ignore: "Elvet",
    capitalizeFirstWord: "Mondatkezdő nagybetűsítés",
    capitalizeFirstWordHint: "Kijavítja a mondat elején lévő kisbetűt.",
    groupGeneral: "Ellenőrzés",
    groupModel: "Modell",
    groupAdvanced: "Haladó",
    recommendedModels: "Ajánlott modellek",
    recBadge: "Ajánlott",
    recColModel: "Modell",
    recColStatus: "Állapot",
    recColNotes: "Megjegyzés",
    recNano: "100% találat, ~2,5 mp, nincs fölösleges stílusjavítás",
    recQwen30: "kiegyensúlyozott – ~4,7 mp, 100% találat",
    recNova: "leggyorsabb/legolcsóbb (~1 mp), de markdown-zajt ad és elbukik kódblokkoknál",
    recMini: "jó alternatíva – ~3,5 mp",
    recAvoid: "Kerüld a reasoning modelleket (pl. deepseek-v4-flash, ~11,5 mp), a ministral-8b-t (78% találat) és a kivont gemini-2.0-flash-001/-lite-001-et (404).",
    debounceMs: "Várakozás gépelés után",
    debounceHint: "Ennyit vár az utolsó leütés után az ellenőrzés előtt. 300–10000.",
    unitMs: "ms",
    unitChars: "karakter",
    minChars: "Legrövidebb szöveg",
    minCharsHint: "A rövidebb üzeneteket nem ellenőrzi.",
    minCharsError: "A leghosszabb szövegnél (az érték: {max}) kisebbnek kell lennie.",
    numberRequired: "Adj meg egy számot.",
    maxChars: "Leghosszabb szöveg",
    maxCharsHint: "A hosszabb üzeneteket nem ellenőrzi.",
    language: "Nyelv",
    languageHintBefore: "BCP-47 címke, például ",
    languageHintMiddle: ", vagy ",
    languageHintAfter: ".",
    llmModel: "Modell",
    loadError: "Nem sikerült betölteni a nyelvhelyesség beállításait. Az alapértékek látszanak; a mentés kikapcsolva, amíg be nem töltenek.",
    saveError: "Nem sikerült menteni a nyelvhelyesség beállításait. Ellenőrizd, hogy a vezérlőpult fut, majd próbáld újra.",
    saveBlockedNotLoaded: "A nyelvhelyesség beállításai még nem töltődtek be, ezért a mentés ki van kapcsolva. Használd az Újrapróbálást, majd mentsd.",
    saveBlockedInvalid: "Mentés előtt javítsd a hibás mezőket.",
    modelHint: "A modell választása befolyásolja a minőséget, a késleltetést és a költséget.",
    modelHintLink: "Mely modellek jók?",
    modelRequired: "Válassz modellt – a nyelvtani ellenőrzés csak beállított modellel fut.",
    "grammar.err.roleUnassigned": "A nyelvtani modell szerepkörhöz nincs modell rendelve – rendeld hozzá a Beállítások → Modell szerepkörök oldalon.",
    modelSelectorUnavailable: "A modellválasztó nem érhető el",
  },
};
