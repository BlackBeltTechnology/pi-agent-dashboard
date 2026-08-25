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
    noData: "无配额数据",
    projected: "预计",
    or: "或",
    needsPeer: "需要 {pkg}",
    needsPeerBody: "请在“扩展包”标签页安装 {pkg} 以跟踪此供应商。",
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
    noData: "Nincs kvótaadat",
    projected: "Előrejelzés",
    or: "vagy",
    needsPeer: "szükséges: {pkg}",
    needsPeerBody: "Telepítsd a(z) {pkg} csomagot (Csomagok fül) a szolgáltató követéséhez.",
  },
} as const;
