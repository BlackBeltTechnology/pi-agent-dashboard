/**
 * Hermes-memory plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the
 * shell merges it under `plugin.hermes-memory.*`. Component code resolves keys
 * via the scoped `useT()` hook, which auto-prefixes `plugin.hermes-memory.`.
 *
 * `zh-CN` and `hu` MUST keep parity (identical key sets — scripts/i18n-parity).
 * English lives at the call sites as the `t(key, vars, fallback)` fallback.
 * Field labels/help are presentation DATA (field-groups.ts), not i18n keys.
 * {var} placeholders are preserved verbatim so `t(key, vars)` can interpolate.
 *
 * See change: add-hermes-memory-settings-plugin.
 */
export const catalog = {
  "zh-CN": {
    loadError: "加载配置失败：{error}",
    loading: "加载中…",
    intro: "以下为",
    introTail: "扩展的配置。保持默认的字段将跟随扩展的内置值。",
    file: "文件：",
    exists: "已存在",
    notCreated: "尚未创建",
    newSessionsNotice:
      "更改仅对新启动的会话生效。Hermes 在扩展加载时读取一次配置，因此运行中的会话在重启前保持当前设置。",
    fields: "个字段",
    nChanged: "已更改 {count} 个字段 · 尚未保存",
    noChanges: "无更改",
    viewRawJson: "查看原始 JSON",
    revert: "还原",
    saving: "保存中…",
    save: "保存",
    resolved: "已解析",
    close: "关闭",
    defaultBadge: "默认",
    reset: "重置",
  },
  hu: {
    loadError: "A konfiguráció betöltése sikertelen: {error}",
    loading: "Betöltés…",
    intro: "A",
    introTail: "bővítmény konfigurációja. Az alapértelmezetten hagyott mezők a bővítmény beépített értékét követik.",
    file: "Fájl:",
    exists: "létezik",
    notCreated: "még nincs létrehozva",
    newSessionsNotice:
      "A módosítások az újonnan indított munkamenetekre vonatkoznak. A Hermes a konfigurációt a bővítmény betöltésekor egyszer olvassa be, ezért a futó munkamenetek újraindításig megtartják a jelenlegi beállításokat.",
    fields: "mező",
    nChanged: "{count} mező módosítva · még nincs mentve",
    noChanges: "Nincs változás",
    viewRawJson: "Nyers JSON megtekintése",
    revert: "Visszaállítás",
    saving: "Mentés…",
    save: "Mentés",
    resolved: "feloldott",
    close: "Bezárás",
    defaultBadge: "alapért.",
    reset: "Visszaállítás",
  },
};
