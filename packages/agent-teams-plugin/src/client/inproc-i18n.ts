/**
 * en / zh-CN / hu string table of the in-process teammate mode: the settings section (labels + help of the
 * `teammateMode`, `inProcessIdleTtlSec`, `inProcessLeanChildren`, `inProcessCmdTimeoutMs`,
 * `inProcessQueueTimeoutMs` keys) and the `mode_unavailable` reason messages. Identical key sets and
 * `{placeholder}` sets in all three locales (`__tests__/inproc-i18n.test.ts`). Lazy table: NOT part of the
 * eager catalog (cold-chunk budget). The Team-view labels of §10 are added by that task.
 * See change: add-agent-teams-in-process.
 */
import type { Tables } from "./lazy-i18n.js";

const en = {
  "settings.title": "In-process teammates",
  "settings.teammateMode.label": "Default teammate mode",
  "settings.teammateMode.help": "Mode used when TeamCreate gives none. Session: one dashboard session per teammate. In-process: background children of the lead.",
  "settings.teammateMode.session": "Session",
  "settings.teammateMode.inProcess": "In-process",
  "settings.idleTtl.label": "Free idle teammates after (s)",
  "settings.idleTtl.help": "Whole seconds, at least 1. Empty keeps idle teammates alive until they are stopped.",
  "settings.lean.label": "Lean children",
  "settings.lean.help": "Load no discovered extensions in a teammate: cheaper and isolated from foreign extensions.",
  "settings.cmdTimeout.label": "Command timeout (ms)",
  "settings.cmdTimeout.help": "How long the lead may take to acknowledge a command, {min}-{max} ms.",
  "settings.queueTimeout.label": "Slot queue timeout (ms)",
  "settings.queueTimeout.help": "Fail a teammate that waits longer than this for a subagent slot. Empty never fails a queued teammate.",
  "unavailable.subagents_extension_missing": "In-process teammates need the pi-dashboard-subagents package. Install release {release} or newer from the Packages tab and reload the session.",
  "unavailable.subagents_extension_outdated": "The installed pi-dashboard-subagents package is too old for in-process teammates. Update it to {release} or newer from the Packages tab.",
  "unavailable.no_context": "The subagents extension is not ready yet. Retry in a moment.",
} as const;

const zhCN: Record<keyof typeof en, string> = {
  "settings.title": "进程内队友",
  "settings.teammateMode.label": "默认队友模式",
  "settings.teammateMode.help": "TeamCreate 未指定时使用的模式。会话：每个队友一个仪表板会话。进程内：组长的后台子代理。",
  "settings.teammateMode.session": "会话",
  "settings.teammateMode.inProcess": "进程内",
  "settings.idleTtl.label": "空闲队友释放时间（秒）",
  "settings.idleTtl.help": "整数秒，至少为 1。留空则空闲队友保持存活，直到被停止。",
  "settings.lean.label": "精简子代理",
  "settings.lean.help": "队友不加载已发现的扩展：更省资源，并与外部扩展隔离。",
  "settings.cmdTimeout.label": "命令超时（毫秒）",
  "settings.cmdTimeout.help": "组长确认命令的最长时间，{min}-{max} 毫秒。",
  "settings.queueTimeout.label": "槽位排队超时（毫秒）",
  "settings.queueTimeout.help": "等待子代理槽位超过该时间的队友将失败。留空则排队的队友永不失败。",
  "unavailable.subagents_extension_missing": "进程内队友需要 pi-dashboard-subagents 软件包。请在“软件包”页安装 {release} 或更高版本，然后重新加载会话。",
  "unavailable.subagents_extension_outdated": "已安装的 pi-dashboard-subagents 软件包版本过旧，无法使用进程内队友。请在“软件包”页将其更新到 {release} 或更高版本。",
  "unavailable.no_context": "子代理扩展尚未就绪，请稍后重试。",
};

const hu: Record<keyof typeof en, string> = {
  "settings.title": "Folyamaton belüli csapattagok",
  "settings.teammateMode.label": "Alapértelmezett csapattag-mód",
  "settings.teammateMode.help": "A TeamCreate által nem megadott módnál használt mód. Munkamenet: csapattagonként egy irányítópult-munkamenet. Folyamaton belüli: a vezető háttérben futó gyermekei.",
  "settings.teammateMode.session": "Munkamenet",
  "settings.teammateMode.inProcess": "Folyamaton belüli",
  "settings.idleTtl.label": "Tétlen csapattagok felszabadítása (mp)",
  "settings.idleTtl.help": "Egész másodperc, legalább 1. Üresen hagyva a tétlen csapattagok leállításukig életben maradnak.",
  "settings.lean.label": "Karcsú gyermekek",
  "settings.lean.help": "A csapattag nem tölt be felfedezett bővítményeket: olcsóbb, és elszigetel az idegen bővítményektől.",
  "settings.cmdTimeout.label": "Parancs időkorlátja (ms)",
  "settings.cmdTimeout.help": "Ennyi ideig igazolhatja vissza a vezető a parancsot, {min}-{max} ms.",
  "settings.queueTimeout.label": "Helysor időkorlátja (ms)",
  "settings.queueTimeout.help": "Az a csapattag, amely ennél tovább vár egy alügynök-helyre, hibára fut. Üresen hagyva a sorban álló csapattag soha nem hibázik.",
  "unavailable.subagents_extension_missing": "A folyamaton belüli csapattagokhoz a pi-dashboard-subagents csomag kell. Telepítse a(z) {release} vagy újabb kiadást a Csomagok lapon, majd töltse újra a munkamenetet.",
  "unavailable.subagents_extension_outdated": "A telepített pi-dashboard-subagents csomag túl régi a folyamaton belüli csapattagokhoz. Frissítse a(z) {release} vagy újabb kiadásra a Csomagok lapon.",
  "unavailable.no_context": "Az alügynök-bővítmény még nem áll készen. Próbálja újra egy pillanat múlva.",
};

export const inprocTables: Tables = { en, "zh-CN": zhCN, hu };
