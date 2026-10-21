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
    forkContextLabel: "共享父级对话",
    forkContextDescription:
      "开启：每个子代理获得父级最近轮次的压缩副本。关闭：每个子代理从空对话开始。",
    saveError: "无法保存子代理设置。请确认仪表板正在运行，然后重新保存。",
    settingsLead: "会话如何启动子代理。",
    rolesNotice:
      "内置的 Explore 代理使用 {role}。请在“模型角色”中为 {role} 指定模型，否则使用角色的代理会报告“尚未配置”。",
    openModelRoles: "打开模型角色",
    // AgentToolRenderer (moved from the shell; task 4.3). en = call-site fallback.
    agentPrompt: "提示词",
    agentPopout: "弹出",
    agentElided: "结果未加载",
    agentWrappedUp: "已结束（达到回合上限）",
    agentError: "错误：",
    agentAborted: "已中止（超出最大回合数）",
    agentStopped: "已停止",
    // SubagentDockGroup (composer dock Processes lane). en = call-site fallback.
    dockNounSubagents: "子代理",
    dockNounSubagentOne: "子代理",
    dockSteps: "{count} 步",
    dockStepOne: "{count} 步",
    dockPending: "待处理",
    dockOpen: "打开",
    dockOpenSubagent: "打开子代理 {name}：{task}",
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
    forkContextLabel: "A szülő beszélgetésének megosztása",
    forkContextDescription:
      "Be: minden alügynök megkapja a szülő legutóbbi köreinek tömörített másolatát. Ki: mindegyik üres beszélgetéssel indul.",
    saveError: "Nem sikerült menteni az alügynök-beállításokat. Ellenőrizd, hogy a dashboard fut-e, majd mentsd újra.",
    settingsLead: "Hogyan indítanak a munkamenetek alügynököket.",
    rolesNotice:
      "A beépített Explore ügynök a(z) {role} szerepet használja. Adj a(z) {role} szerepnek modellt a Modellszerepek oldalon, különben a szerepeket használó ügynökök „még nincs beállítva” hibát jelentenek.",
    openModelRoles: "Modellszerepek megnyitása",
    // AgentToolRenderer (moved from the shell; task 4.3). en = call-site fallback.
    agentPrompt: "Kérés",
    agentPopout: "Kiemelés",
    agentElided: "eredmény nincs betöltve",
    agentWrappedUp: "Lezárva (körhatár)",
    agentError: "Hiba:",
    agentAborted: "Megszakítva (max. körök túllépve)",
    agentStopped: "Leállítva",
    dockNounSubagents: "alügynök",
    dockNounSubagentOne: "alügynök",
    dockSteps: "{count} lépés",
    dockStepOne: "{count} lépés",
    dockPending: "függőben",
    dockOpen: "Megnyitás",
    dockOpenSubagent: "Alügynök megnyitása: {name} — {task}",
  },
};
