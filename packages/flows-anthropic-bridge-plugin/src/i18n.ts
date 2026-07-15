/**
 * Anthropic Messages Bridge plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the
 * shell merges it under `plugin.flows-anthropic-bridge.*`. Component code
 * resolves keys via the scoped `useT()` hook, which auto-prefixes
 * `plugin.flows-anthropic-bridge.`.
 *
 * zh-CN and hu MUST keep parity (identical key sets). {var} placeholders are
 * preserved verbatim so `t(key, vars)` can interpolate.
 *
 * See change: make-all-ui-text-i18n.
 */
export const catalog = {
  "zh-CN": {
    heading: "pi-flows · Anthropic 消息桥接",
    descForwards: "转发",
    descHooks: "钩子到每个 pi-flows 代理子进程。仅当两个对等组件（",
    descAnd: "和",
    descResolve: "）在 pi 进程中解析时才激活。",
    bannerNoSessions: "尚无 pi 会话报告。启动一个 pi 会话以查看状态。",
    bannerActive: "桥接在所有 pi 会话中处于活动状态。",
    bannerDegraded: "一个或多个对等组件不可用。请参见下方的每会话详情。",
    refresh: "刷新",
    colStatus: "状态",
    peerMissing: "缺失",
    gateOverrides: "闸门覆盖",
    forceLabel: "强制打开闸门（任何 anthropic-messages 模型 — 设置",
    disableLabel: "完全禁用桥接（设置",
    save: "保存",
  },
  hu: {
    heading: "pi-flows · Anthropic üzenet-híd",
    descForwards: "Továbbítja a",
    descHooks:
      "horgokat minden pi-flows ügynök-alfolyamatba. Csak akkor aktiválódik, ha mindkét társ (",
    descAnd: "és",
    descResolve: ") feloldódik a pi folyamatban.",
    bannerNoSessions:
      "Még egy pi munkamenet sem jelez. Indíts egy pi munkamenetet az állapot megtekintéséhez.",
    bannerActive: "A híd minden pi munkamenetben aktív.",
    bannerDegraded:
      "Egy vagy több társ nem érhető el. Lásd a munkamenetenkénti részleteket alább.",
    refresh: "Frissítés",
    colStatus: "Állapot",
    peerMissing: "hiányzik",
    gateOverrides: "Kapu felülbírálások",
    forceLabel: "Kapu kényszerített nyitása (bármely anthropic-messages modell — beállítja",
    disableLabel: "Híd teljes letiltása (beállítja",
    save: "Mentés",
  },
};
