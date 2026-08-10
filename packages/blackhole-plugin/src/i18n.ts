/**
 * Blackhole plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared as
 * `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the shell
 * merges it under `plugin.blackhole.*`. Component code resolves keys via the
 * scoped `useT()` hook, which auto-prefixes `plugin.blackhole.`.
 *
 * `zh-CN` and `hu` MUST keep parity (identical key sets — scripts/i18n-parity).
 * English lives at the call sites as the `t(key, vars, fallback)` fallback.
 * Field labels/help are presentation DATA (field-groups.ts), not i18n keys.
 *
 * See change: add-blackhole-plugin.
 */
export const catalog = {
  "zh-CN": {
    loadError: "加载配置失败：{error}",
    loading: "加载中…",
    notInstalledTitle: "尚未安装 pi-blackhole",
    notInstalledBody:
      "此页面用于配置 pi-blackhole 扩展 —— 统一的算法压缩与观察式记忆。请在任意 pi 会话中安装后重新加载。",
    parseErrorTitle: "配置文件无法解析 —— 编辑已停用",
    parseErrorBody:
      "Blackhole 的全部设置都在这一个文件中。由于无法读取，本页没有可显示的值 —— 显示默认值会错误地表述你的会话实际运行的配置。",
    recheck: "重新检查文件",
    saveBlocked: "保存",
    intro: "以下为",
    introTail: "扩展的压缩与观察式记忆设置。",
    file: "文件：",
    notCreated: "尚未创建",
    nUnmanaged: "已保留 {count} 个未管理的键",
    applyNote:
      "pi-blackhole 在每次写入后都会重新读取该文件，因此已保存的更改会自行到达运行中的会话。本页不管理的键（包括 _comment 注释）会原样保留。",
    fields: "个字段",
    workerModels: "工作模型",
    chains: "条链",
    chainsHelp:
      "每个工作器自上而下依次尝试其模型。返回可重试错误的模型会在其冷却窗口内被跳过，随后运行下一个。",
    primary: "主模型",
    inherit: "（继承）",
    mProvider: "提供方",
    mModelId: "模型 ID",
    mThinking: "思考等级",
    mCooldown: "冷却（小时）",
    mContextWindow: "上下文窗口",
  },
  hu: {
    loadError: "A konfiguráció betöltése sikertelen: {error}",
    loading: "Betöltés…",
    notInstalledTitle: "A pi-blackhole nincs telepítve",
    notInstalledBody:
      "Ez az oldal a pi-blackhole bővítményt konfigurálja — egyesített algoritmikus tömörítés és megfigyelési memória. Telepítsd bármelyik pi munkamenetben, majd tölts újra.",
    parseErrorTitle: "A konfigurációs fájl nem értelmezhető — a szerkesztés le van tiltva",
    parseErrorBody:
      "A Blackhole minden beállítása ebben az egy fájlban van. Mivel nem olvasható, ennek az oldalnak nincs megjeleníthető értéke — az alapértelmezettek megjelenítése félrevezetően mutatná, mi fut valójában.",
    recheck: "Fájl újraellenőrzése",
    saveBlocked: "Mentés",
    intro: "A",
    introTail: "bővítmény tömörítési és megfigyelési memória beállításai.",
    file: "Fájl:",
    notCreated: "még nincs létrehozva",
    nUnmanaged: "{count} nem kezelt kulcs megőrizve",
    applyNote:
      "A pi-blackhole minden írás után újraolvassa ezt a fájlt, így a mentett változások maguktól elérik a futó munkameneteket. Az oldal által nem kezelt kulcsok (beleértve a _comment megjegyzéseket) érintetlenül megmaradnak.",
    fields: "mező",
    workerModels: "Munkamodellek",
    chains: "lánc",
    chainsHelp:
      "Minden munkás fentről lefelé próbálja a modelljeit. Az újrapróbálható hibát adó modellt a hűtési ablakára kihagyja, és a következő fut.",
    primary: "Elsődleges",
    inherit: "(öröklött)",
    mProvider: "Szolgáltató",
    mModelId: "Modell azonosító",
    mThinking: "Gondolkodás",
    mCooldown: "Hűtés (óra)",
    mContextWindow: "Kontextusablak",
  },
};
