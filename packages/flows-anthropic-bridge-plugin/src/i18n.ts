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
    descForwards: "将",
    descHooks: "钩子传递给每个 pi-flows 代理子进程。",
    descAnd: "和",
    descResolve: "）在 pi 进程中解析时才激活。",
    bannerNoSessions: "尚无 pi 会话报告。启动一个会话以查看桥接状态。",
    bannerActive: "桥接在全部 {count} 个会话中处于活动状态。",
    bannerActiveOne: "桥接在 1 个会话中处于活动状态。",
    bannerDegraded: "{total} 个会话中有 {count} 个未激活，因此桥接在这些会话中已关闭。",
    bannerDegradedOne: "{total} 个会话中有 1 个未激活，因此桥接在该会话中已关闭。",
    refresh: "刷新",
    loadingSessions: "正在检查会话…",
    fetchFailed: "无法刷新桥接状态。下方列表可能已过期。",
    tableCaption: "每个 pi 会话的桥接状态",
    colSession: "会话进程",
    colStatus: "桥接",
    statusActive: "活动",
    statusWaiting: "等待对等组件",
    statusDegraded: "降级",
    statusProbing: "检查中",
    statusUnknown: "未知",
    peerLoaded: "已加载",
    peerMissing: "缺失",
    gateOverrides: "桥接闸门",
    gateAuto: "自动",
    gateOn: "始终开启",
    gateOff: "关闭",
    gateConflict: "两个覆盖项同时被设置，这是矛盾的。请在下方选择一项。",
    hintAuto: "仅当",
    hintAutoEnd: "都在会话中加载时，桥接才会开启。",
    forceLabel: "对每个 Anthropic Messages 模型强制启用桥接。设置",
    disableLabel: "在所有会话中关闭桥接。设置",
    save: "保存",
  },
  hu: {
    heading: "pi-flows · Anthropic üzenet-híd",
    descForwards: "Átadja a",
    descHooks: "horgokat minden pi-flows ügynök-alfolyamatnak.",
    descAnd: "és",
    descResolve: ") feloldódik a pi folyamatban.",
    bannerNoSessions:
      "Még egy pi munkamenet sem jelentkezett. Indíts egy munkamenetet a híd állapotának megtekintéséhez.",
    bannerActive: "A híd mind a {count} munkamenetben aktív.",
    bannerActiveOne: "A híd 1 munkamenetben aktív.",
    bannerDegraded: "{total} munkamenetből {count} nem aktív, ezért ott a híd ki van kapcsolva.",
    bannerDegradedOne: "{total} munkamenetből 1 nem aktív, ezért ott a híd ki van kapcsolva.",
    refresh: "Frissítés",
    loadingSessions: "Munkamenetek ellenőrzése…",
    fetchFailed: "A híd állapotát nem sikerült frissíteni. Az alábbi lista elavult lehet.",
    tableCaption: "A híd állapota pi munkamenetenként",
    colSession: "Munkamenet-folyamat",
    colStatus: "Híd",
    statusActive: "Aktív",
    statusWaiting: "Társakra vár",
    statusDegraded: "Csökkentett",
    statusProbing: "Ellenőrzés",
    statusUnknown: "Ismeretlen",
    peerLoaded: "Betöltve",
    peerMissing: "Hiányzik",
    gateOverrides: "Híd kapuja",
    gateAuto: "Automatikus",
    gateOn: "Mindig be",
    gateOff: "Ki",
    gateConflict: "Mindkét felülbírálás be van állítva, ami ellentmondásos. Válassz egyet lent.",
    hintAuto: "A híd csak akkor kapcsol be, ha a",
    hintAutoEnd: "mindkettő betöltődik a munkamenetben.",
    forceLabel: "Kényszeríti a hidat minden Anthropic Messages modellhez. Beállítja:",
    disableLabel: "Kikapcsolja a hidat minden munkamenetben. Beállítja:",
    save: "Mentés",
  },
};
