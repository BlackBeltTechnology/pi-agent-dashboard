/**
 * Web-access plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared as
 * `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest); the shell
 * merges it under `plugin.web-access.*`. Components resolve keys via the scoped
 * `useT()` hook. English lives at the call sites as the `t(key, vars, fallback)`
 * fallback. `zh-CN` and `hu` MUST keep identical key sets.
 *
 * See change: render-unclaimed-custom-entries.
 */
export const catalog = {
  "zh-CN": {
    labelSearch: "网络搜索",
    labelFetch: "网页抓取",
    labelResearch: "网络研究",
    labelGeneric: "网络搜索结果",
    queriesOne: "{count} 个查询",
    queriesOther: "{count} 个查询",
    resultsOne: "{count} 条结果",
    resultsOther: "{count} 条结果",
    urlsOne: "{count} 个网址",
    urlsOther: "{count} 个网址",
    expand: "展开条目",
    collapse: "折叠条目",
    loading: "加载中…",
    detailsUnavailable: "详情不可用：{error}",
    moreItems: "另有 {count} 项",
    skippedItems: "有 {count} 项无法显示",
    noResults: "无结果",
    answerLabel: "回答",
    providerLabel: "来源：{provider}",
    sizeChars: "{count} 个字符",
  },
  hu: {
    labelSearch: "Webes keresés",
    labelFetch: "Weboldal-letöltés",
    labelResearch: "Webes kutatás",
    labelGeneric: "Webes keresési találatok",
    queriesOne: "{count} lekérdezés",
    queriesOther: "{count} lekérdezés",
    resultsOne: "{count} találat",
    resultsOther: "{count} találat",
    urlsOne: "{count} URL",
    urlsOther: "{count} URL",
    expand: "Bejegyzés kibontása",
    collapse: "Bejegyzés összecsukása",
    loading: "Betöltés…",
    detailsUnavailable: "A részletek nem érhetők el: {error}",
    moreItems: "még {count} elem",
    skippedItems: "{count} elem nem jeleníthető meg",
    noResults: "Nincs találat",
    answerLabel: "Válasz",
    providerLabel: "Szolgáltató: {provider}",
    sizeChars: "{count} karakter",
  },
} as const;
