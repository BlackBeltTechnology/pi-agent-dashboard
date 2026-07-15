/**
 * Roles plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the
 * shell merges it under `plugin.roles.*`. Component code resolves keys via the
 * scoped `useT()` hook, which auto-prefixes `plugin.roles.`.
 *
 * zh-CN and hu MUST keep parity (identical key sets). {var} placeholders are
 * preserved verbatim so `t(key, vars)` can interpolate.
 *
 * See change: make-all-ui-text-i18n.
 */
export const catalog = {
  "zh-CN": {
    rolesHeading: "角色",
    rolesSubheading: "全局角色 → 模型分配",
    setupBanner: "尚未设置任何角色 — 请在下方为某个角色分配模型以立即设置。",
    addModel: "+ 添加模型",
    addCustomRole: "+ 添加自定义角色",
    customRoleNamePlaceholder: "自定义角色名称…",
    cancelAddCustomRole: "取消添加自定义角色",
    pickModelForRole: "为此角色选择模型",
    setModelForRole: "为 @{role} 设置模型",
    unsaved: "未保存",
    removeCustomRoleLabel: "移除自定义角色 @{role}",
    removeCustomRoleConfirm: "移除自定义角色 @{role}？这将从每个预设中删除它。",
    noLiveSession: "没有可用于应用角色更改的活动 pi 会话",
    discardUnsavedRoleChanges: "放弃未保存的角色更改？",
    saveCurrentAsPreset: "+ 将当前保存为预设",
    presetNamePlaceholder: "预设名称…",
    unsavedEditsSavedFirst: "未保存的编辑将先被保存。",
    deletePresetLabel: "删除预设 {name}",
    deletePresetTitle: '删除预设 "{name}"',
    builtinGroup: "内置",
    customGroup: "自定义",
    assignModelTo: "分配模型给",
  },
  hu: {
    rolesHeading: "Szerepek",
    rolesSubheading: "globális szerep → modell hozzárendelések",
    setupBanner:
      "Még nincs beállított szerep — állítsd be most úgy, hogy alább modellt rendelsz egy szerephez.",
    addModel: "+ Modell hozzáadása",
    addCustomRole: "+ Egyéni szerep hozzáadása",
    customRoleNamePlaceholder: "egyéni-szerep-név…",
    cancelAddCustomRole: "Egyéni szerep hozzáadásának megszakítása",
    pickModelForRole: "Válassz modellt ehhez a szerephez",
    setModelForRole: "Állíts be modellt a(z) @{role} szerephez",
    unsaved: "nincs mentve",
    removeCustomRoleLabel: "@{role} egyéni szerep eltávolítása",
    removeCustomRoleConfirm:
      "Eltávolítod a(z) @{role} egyéni szerepet? Ez minden előbeállításból törli.",
    noLiveSession: "Nincs élő pi munkamenet a szerepváltozások alkalmazásához",
    discardUnsavedRoleChanges: "Elveted a nem mentett szerepváltozásokat?",
    saveCurrentAsPreset: "+ Jelenlegi mentése előbeállításként",
    presetNamePlaceholder: "előbeállítás neve…",
    unsavedEditsSavedFirst: "A nem mentett szerkesztések előbb mentésre kerülnek.",
    deletePresetLabel: "{name} előbeállítás törlése",
    deletePresetTitle: '"{name}" előbeállítás törlése',
    builtinGroup: "Beépített",
    customGroup: "Egyéni",
    assignModelTo: "Modell hozzárendelése ehhez:",
  },
};
