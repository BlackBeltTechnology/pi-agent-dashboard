/**
 * Subagents plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the
 * shell merges it under `plugin.subagents.*`. Component code resolves keys via
 * the scoped `useT()` hook, which auto-prefixes `plugin.subagents.`.
 *
 * zh-CN and hu MUST keep parity (identical key sets). {var} placeholders are
 * preserved verbatim so `t(key, vars)` can interpolate.
 *
 * See change: make-all-ui-text-i18n.
 */
export const catalog = {
  "zh-CN": {
    subagentNotFound: "在此会话中未找到子代理。",
    result: "结果",
    noDetailYet: "暂无详细信息。",
    loadingParentSession: "正在加载父会话…",
    parentSessionNotFound: "未找到父会话",
    parentSessionNotFoundBody:
      "它可能已被归档或删除。请关闭此标签页 — 启动此子代理的会话在仪表板中已不再可用。",
    closeTab: "关闭标签页",
    back: "返回",
    subagentBreadcrumb: "子代理 · {label}",
    subagentNotFoundCleared: "未找到子代理 — 它可能已从父会话的历史记录中清除。",
    subagentInspectorHeading: "子代理检查器",
    producerSettingsPre: "用于 ",
    producerSettingsPost: " 生产者的设置。",
    rolesDepConfigurePre: "配置 ",
    rolesDepPluginResolve: " 插件，以便内置的 ",
    rolesDepAgentResolve: " 代理能够解析 ",
    rolesDepIfNoModel: "。如果没有为 ",
    rolesDepAgentsUsing: " 分配模型，使用 ",
    rolesDepAliasesReport:
      " 别名的代理在生成时会报告“尚未配置” — 子代理仍会加载。",
    forkContextLabel: "将父上下文分叉到每个子代理",
    forkContextDescription:
      "开启时，子代理会继承父级最近轮次的压缩副本。关闭时，每个子代理都以空对话开始（隔离）。",
    saveError: "HTTP {status}：{detail}",
  },
  hu: {
    subagentNotFound: "Nem található alügynök ebben a munkamenetben.",
    result: "Eredmény",
    noDetailYet: "Még nincs részlet.",
    loadingParentSession: "Szülő munkamenet betöltése…",
    parentSessionNotFound: "A szülő munkamenet nem található",
    parentSessionNotFoundBody:
      "Lehet, hogy archiválták vagy törölték. Zárd be ezt a lapot — az a munkamenet, amelyből ezt az alügynököt indították, már nem érhető el az irányítópulton.",
    closeTab: "Lap bezárása",
    back: "Vissza",
    subagentBreadcrumb: "Alügynök · {label}",
    subagentNotFoundCleared:
      "Az alügynök nem található — lehet, hogy törölték a szülő munkamenet előzményeiből.",
    subagentInspectorHeading: "Alügynök-vizsgáló",
    producerSettingsPre: "Beállítások a(z) ",
    producerSettingsPost: " producerhez.",
    rolesDepConfigurePre: "Állítsd be a(z) ",
    rolesDepPluginResolve: " plugint, hogy a beépített ",
    rolesDepAgentResolve: " ügynök fel tudja oldani a(z) ",
    rolesDepIfNoModel: " aliast. Ha nincs modell hozzárendelve a(z) ",
    rolesDepAgentsUsing: " aliashoz, a(z) ",
    rolesDepAliasesReport:
      " aliast használó ügynökök „még nincs beállítva” hibát jelentenek indításkor — az Alügynökök továbbra is betöltődik.",
    forkContextLabel: "A szülő kontextusának elágaztatása minden alügynökbe",
    forkContextDescription:
      "Bekapcsolva az alügynök a szülő legutóbbi köreinek tömörített másolatát örökli. Kikapcsolva minden alügynök üres beszélgetéssel indul (izolált).",
    saveError: "HTTP {status}: {detail}",
  },
};
