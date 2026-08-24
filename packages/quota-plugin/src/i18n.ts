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
    tosTitle: "使用条款确认",
    tosBody:
      "配额跟踪调用未公开的供应商端点，可能违反供应商条款。已排除 Anthropic。仅供个人/本地使用。",
    tosAck: "我已理解并接受",
    providersLegend: "按供应商启用",
    enableQuota: "启用配额跟踪",
    all: "全部",
    onPace: "正常",
    unavailable: "配额不可用",
    noData: "无配额数据",
    projected: "预计",
  },
  hu: {
    heading: "Szolgáltatói kvóta",
    tosTitle: "Felhasználási feltételek elfogadása",
    tosBody:
      "A kvótakövetés nem dokumentált szolgáltatói végpontokat hív, ami sértheti a szolgáltató feltételeit. Az Anthropic ki van zárva. Csak személyes/helyi használatra.",
    tosAck: "Megértettem és elfogadom",
    providersLegend: "Engedélyezés szolgáltatónként",
    enableQuota: "Kvótakövetés engedélyezése",
    all: "Összes",
    onPace: "ütemben",
    unavailable: "kvóta nem elérhető",
    noData: "Nincs kvótaadat",
    projected: "Előrejelzés",
  },
} as const;
