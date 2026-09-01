/**
 * Provider Quota plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The shell merges this under `plugin.quota.*`; component code resolves keys
 * via the scoped `useT()` hook (auto-prefixes `plugin.quota.`) with an English
 * fallback passed inline. zh-CN and hu keep key parity. {var} placeholders are
 * preserved verbatim.
 */
export const catalog = {
  "zh-CN": {
    heading: "供应商配额",
    tosTitle: "警告",
    tosBody: "配额跟踪调用未公开的供应商端点，可能违反供应商条款。仅供个人/本地使用。",
    now: "现在",
    providersLegend: "按供应商启用",
    enableQuota: "启用配额跟踪",
    all: "全部",
    onPace: "正常",
    overBy: "超出 {pct}%",
    stale: "重置待定",
    unavailable: "配额不可用",
    projected: "预计",
    reasonNoCredential: "未登录",
    reasonRejected: "供应商拒绝了请求",
    reasonNoData: "未报告配额",
    reasonNoAdapter: "不支持",
    resetsIn: "{t} 后重置",
    retained: "非实时",
    retainedBody: "最近一次刷新失败，显示的是上次已知的数值。",
  },
  hu: {
    heading: "Szolgáltatói kvóta",
    tosTitle: "Figyelmeztetés",
    tosBody:
      "A kvótakövetés nem dokumentált szolgáltatói végpontokat hív, ami sértheti a szolgáltató feltételeit. Csak személyes/helyi használatra.",
    now: "most",
    providersLegend: "Engedélyezés szolgáltatónként",
    enableQuota: "Kvótakövetés engedélyezése",
    all: "Összes",
    onPace: "ütemben",
    overBy: "túllépés {pct}%",
    stale: "visszaállítás függőben",
    unavailable: "kvóta nem elérhető",
    projected: "Előrejelzés",
    reasonNoCredential: "nincs bejelentkezés",
    reasonRejected: "a szolgáltató elutasította a kérést",
    reasonNoData: "nincs jelentett kvóta",
    reasonNoAdapter: "nem támogatott",
    resetsIn: "{t} múlva nullázódik",
    retained: "nem élő",
    retainedBody: "A legutóbbi frissítés sikertelen volt, az utoljára ismert értékek láthatók.",
  },
} as const;
