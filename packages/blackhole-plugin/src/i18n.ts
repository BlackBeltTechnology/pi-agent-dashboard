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
    workersOff: "记忆工作器已关闭 —— 压缩仍然运行。",
    noActivity: "尚无记忆活动。",
    stateRecorded: "已记录",
    stateNotDue: "未到期",
    stateEmpty: "空",
    stateSkipped: "已跳过",
    stateInitial: "初始",
    stateError: "错误",
    stateOther: "其他状态",
    stateUnknown: "无游标",
    workerStateA11y: "{worker}: {state}",
    workerCoolingA11y: "{worker}：使用回退模型 {model}，冷却约 {minutes} 分钟",
    lagLabel: "滞后",
    lagA11y: "游标滞后 {lag} 条",
    lagStale: "游标超前于历史",
    lagStaleA11y: "游标超前于已记录的历史",
    proximityLabel: "压缩临近度 ≈",
    proximityA11y: "压缩临近度（近似值）",
    proximityExplain:
      "近似值：blackhole 统计的是不同的量。此估算使用仪表盘自身的 token 统计 —— 两者不可互相换算。",
    pendingAdvisory: "{count} 个批次待处理 —— 使用 /blackhole 冲刷。",
    cooldownAdvisory: "{model} 冷却中 —— 约 {minutes} 分钟后恢复。",
    detailButton: "详情",
    backToChat: "← 返回对话",
    detailTitle: "记忆管线详情",
    workerColumn: "工作器",
    cursorColumn: "游标",
    resolvedColumn: "解析后的模型",
    cursorsSource: "工作器游标 —— 来源：pi-blackhole/<会话 id>-pending.json",
    cooldownReason: "已冷却：{reason}",
    cooldownSource:
      "冷却回退与原因 —— 来源：pi-blackhole/pi-blackhole-cooldown.json（主模型来自配置）",
    proximitySource:
      "由仪表盘自身的 token 统计对 compactAfterTokens 估算。blackhole 的计数器统计不同的量且不持久化 —— 两者不可换算。",
    transcriptNote:
      "观察与反思的计数仅在会话运行时存在 —— 观察与反思出现在会话转录中。",
    pipelineLoadError: "无法加载管线状态。",
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
    workersOff: "A memória-munkások kikapcsolva — a tömörítés tovább fut.",
    noActivity: "Még nincs memóriatevékenység.",
    stateRecorded: "rögzítve",
    stateNotDue: "esedékes nem",
    stateEmpty: "üres",
    stateSkipped: "kipihentetve",
    stateInitial: "kezdeti",
    stateError: "hiba",
    stateOther: "egyéb állapot",
    stateUnknown: "nincs kurzor",
    workerStateA11y: "{worker}: {state}",
    workerCoolingA11y: "{worker}: {model} tartalékmodellen, kb. {minutes} perc hűtés",
    lagLabel: "Lemaradás",
    lagA11y: "kurzor {lag} bejegyzéses lemaradásban",
    lagStale: "A kurzor az előzmények előtt jár",
    lagStaleA11y: "a kurzor a rögzített előzmények előtt jár",
    proximityLabel: "Tömörítés közelsége ≈",
    proximityA11y: "tömörítés közelsége, közelítő",
    proximityExplain:
      "Közelítő: a blackhole más mennyiséget számol. Ez a becslés a dashboard saját tokenszámítását használja — a kettő nem váltható át.",
    pendingAdvisory: "{count} tétel vár —— /blackhole paranccsal üríthető.",
    cooldownAdvisory: "{model} hűtésben —— kb. {minutes} perc múlva áll vissza.",
    detailButton: "Részletek",
    backToChat: "← Vissza a beszélgetéshez",
    detailTitle: "Memória-folyamat részletei",
    workerColumn: "Munkás",
    cursorColumn: "Kurzor",
    resolvedColumn: "Feloldott modell",
    cursorsSource: "Munkás kurzorok — forrás: pi-blackhole/<munkamenet id>-pending.json",
    cooldownReason: "Hűtésben: {reason}",
    cooldownSource:
      "Hűtéses tartalékok és okok — forrás: pi-blackhole/pi-blackhole-cooldown.json (az elsődleges modellek a konfigból)",
    proximitySource:
      "A dashboard saját tokenszámításából becsülve a compactAfterTokens ellen. A blackhole számlálója más mennyiséget mér és nem perzisztált —— a kettő nem váltható át.",
    transcriptNote:
      "A megfigyelési és reflexiós számlálók csak futó munkamenetben léteznek — a megfigyelések és reflexiók a munkamenet átiratában jelennek meg.",
    pipelineLoadError: "A folyamat állapota nem tölthető be.",
  },
};
