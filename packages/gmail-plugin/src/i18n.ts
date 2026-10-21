/**
 * Gmail plugin i18n catalog — UNPREFIXED leaf keys, merged by the shell under
 * `plugin.gmail.*`; components resolve via the scoped `useT()`. English lives
 * at the call sites as the fallback. `zh-CN` and `hu` MUST keep identical key
 * sets (scripts/i18n-parity). See change: add-gmail-plugin.
 */
export const catalog = {
  "zh-CN": {
    accounts: "账户",
    addAccount: "添加账户",
    aliasLabel: "别名",
    aliasPlaceholder: "别名",
    aliasSaved: "已保存",
    audienceErrors:
      "Google 错误页面：org_internal = 账户不属于该组织，请改为“外部”；access_denied = 将账户添加为测试用户；admin_policy_enforced = 该账户的 Workspace 管理员必须信任此 OAuth 客户端。",
    audienceHelp:
      "“内部”仅允许项目所属 Workspace 组织的账户：只有当你要连接的每个账户都属于该组织时才选择它。否则选择“外部”，并将要连接的每个地址添加为测试用户。测试模式下令牌 7 天后过期。发布应用可取消 7 天令牌过期限制；未验证的应用会显示 Google 警告，且最多允许 100 个用户；在测试模式下添加的账户在发布后需要重新验证一次。",
    clientHelp: "应用类型：桌面应用。下载 JSON。若链接已变更：API 和服务 → 凭据。",
    consentHint:
      "Google 以复选框（请勾选）或显示应用“想要获得额外访问权限”的第二个屏幕（请接受）的方式请求 Gmail 权限。只完成第一个屏幕只会让你登录。",
    copied: "已复制",
    copy: "复制",
    copyFailed: "复制失败",
    createProject: "创建项目",
    crossOrgHint: "项目 Workspace 组织之外的账户需要“外部”目标对象，并将每个账户添加为测试用户（第 3 步）。",
    enableGmail: "启用 Gmail API",
    errAborted: "登录已中止。",
    errAccessDenied: "Google 拒绝了访问：该账户不是允许的测试用户，或拒绝了同意。请将账户添加为测试用户（第 3 步）后重试。",
    errAccountMismatch: "你登录了另一个 Google 账户。请使用该行显示的账户重新验证。",
    errAdminPolicy: "此账户的 Google Workspace 管理员阻止了该应用。请让该管理员信任 OAuth 客户端 {clientId}（管理控制台 → 安全 → API 控制 → 应用访问控制）。",
    errAliasTaken: "该别名已被其他账户使用。",
    errAuthorization: "Google 报告了登录错误。请重试；若反复出现，请检查上面的设置步骤。",
    errBadClientId: "客户端 ID 不以 .apps.googleusercontent.com 结尾（第 4 步）。",
    errCallbackFailed: "登录回调失败。请重试。",
    errCancelled: "登录已取消。",
    errClientInUse: "当前客户端下已连接账户。请先撤销它们，再上传其他客户端。",
    errEmailUnverified: "Google 报告此账户的电子邮件未验证。请在 Google 完成验证后重试。",
    errGeneric: "登录失败。请重试；若一直失败，请检查上面的设置步骤。",
    errIdToken: "无法验证 Google 的登录响应。请重试。",
    errInvalidAlias: "别名为 1–40 个字母、数字、“.”、“_”或“-”。",
    errInvalidClient: "Google 无法识别该 OAuth 客户端。请重新下载其 JSON 并上传（第 5 步）。",
    errInvalidRedirect: "粘贴的地址不是 Google 发送的重定向。请粘贴浏览器地址栏中的完整 URL。",
    errLoginFailed: "无法开始登录。请重试。",
    errMissingRefresh: "Google 未返回长期令牌。请在 myaccount.google.com/permissions 撤销该应用，然后重新添加账户。",
    errMissingSecret: "文件中没有客户端密钥。请从客户端页面重新下载（第 5 步）。",
    errNotInstalled: "此文件中没有桌面（installed）客户端。请创建桌面应用客户端（第 4 步）。",
    errNotJson: "该文件不是有效的 JSON。请上传你下载的 client_secret_*.json（第 5 步）。",
    errOrgInternal: "Google 阻止了此账户：OAuth 应用的目标对象为“内部”，仅允许项目所属 Workspace 组织的账户。请将目标对象改为“外部”，并将此账户添加为测试用户（第 3 步）。",
    errRedirectMismatch: "Google 拒绝了重定向地址。请创建桌面应用客户端，而不是 Web 客户端（第 4 步）。",
    errScopeMissing:
      "Google 未授予 Gmail 权限。Google 要么以必须勾选的复选框、要么在第二个屏幕（“想要获得额外访问权限”）上请求该权限，必须接受——只完成第一个屏幕只会让你登录。请在 myaccount.google.com/connections 移除此应用的访问权限，然后重新添加账户。",
    errStartTimeout: "登录未能及时开始。请重试。",
    errStateMismatch: "粘贴的重定向属于另一次登录。请重新开始，并粘贴本次登录的 URL。",
    errTimeout: "等待 Google 超时。如果 Google 显示了错误页面，请通过登录链接下方的选项报告。",
    errTokenExchange: "Google 拒绝交换登录代码。请检查上传的客户端（第 5 步）后重试。",
    errWebClient: "这是 Web 应用客户端。请改为创建桌面应用客户端（第 4 步）。",
    fallback2: "若链接已变更：API 和服务 → OAuth 同意屏幕。",
    googleErrorHelp: "选择 Google 显示的错误代码：",
    googleErrorSummary: "Google 显示了错误而没有返回这里？",
    level: "级别",
    levelHelp:
      "级别由本插件执行，而非 Google：令牌带有 Google 授予的全部范围（draft 级的撰写权限理论上也能发送），因此级别限制的是代理工具可以做什么。此仪表盘上的任何会话都可以在级别范围内使用每个账户。",
    loading: "加载中…",
    newLevel: "新账户的级别",
    noAccounts: "尚未连接账户。",
    openAudience: "打开“目标对象”",
    openBranding: "打开“品牌”",
    openClients: "创建客户端",
    projectId: "项目 ID",
    reauth: "重新验证",
    reportOther: "其他错误",
    revoke: "撤销",
    revokeConfirm: "撤销 {email}？仪表盘将忘记该账户，并请求 Google 撤销其访问权限。",
    revokedOk: "{email} 已移除，并已在 Google 撤销访问权限。",
    revokeManual: "{email} 已在本地移除，但无法连接 Google。请在 myaccount.google.com/permissions 撤销访问权限。",
    setup: "Google Cloud 设置",
    statusOk: "已连接",
    statusReauth: "需要重新验证",
    stepDone: "已完成",
    aliasFor: "{email} 的别名",
    levelFor: "{email} 的级别",
    revokeFor: "撤销 {email}",
    reauthFor: "重新验证 {email}",
    addAccountDisabled: "上传 OAuth 客户端 JSON（上面第 5 步）后即可使用。",
    step1: "1. Google Cloud 项目 + Gmail API",
    step2: "2. 品牌",
    step3: "3. 目标对象 + 测试用户",
    step4: "4. 桌面 OAuth 客户端",
    step5: "5. 上传 client_secret_*.json",
    step6: "6. 测试登录",
    step6Help: "在下方添加第一个账户 —— 这就是测试登录。",
    summaryClient: "✓ {clientId}",
    summaryNotConfigured: "未配置",
    summaryProject: "✓ 项目 {projectId}",
    testingBadge: "测试：7 天",
    testingHint: "测试模式应用：Google 会在 7 天后使此授权过期。",
    tierDraft: "读取 + 创建草稿",
    tierReadonly: "读取邮件",
    tierSend: "读取、草稿、发送、回复、标签、归档、删除",
    title: "Gmail",
    uploadLabel: "上传 OAuth 客户端 JSON",
    withGcloud: "使用 gcloud（请自行运行）：",
    withoutGcloud: "不使用 gcloud：",
    projectModeLegend:
      "项目",
    projectModeNew:
      "创建新项目",
    projectModeExisting:
      "使用现有项目",
    projectIdHint:
      "你的 Google Cloud 项目的 ID，而不是显示名称：小写字母、数字和连字符，例如 my-gmail-agent。控制台的项目列表同时显示两者；ID 在“ID”列。",
    openProjectList:
      "打开项目列表",
    ownerAccount:
      "所有者账户（可选）",
    ownerHint:
      "拥有该项目的 Google 账户。控制台链接和 gcloud 命令将以此账户而不是浏览器的默认账户执行。",
    errOwnerInvalid:
      "请输入完整的电子邮件地址，例如 you@gmail.com。",
    errSetupSave:
      "无法保存项目 ID，因此未发送上传。请重试（第 1 步）。",
    errProjectLooksLikeName:
      "这看起来像项目名称。向导需要项目 ID（小写，例如 pidashboard-510015）：打开项目列表并复制“ID”列。",
    errProjectInvalid:
      "项目 ID 为 6–30 个字符：小写字母、数字和连字符，以字母开头，且不以连字符结尾。",
    projectMismatch:
      "上传的客户端属于项目 {json}，但已保存的项目 ID 是 {saved}。",
    projectMismatchUse:
      "使用 {id}",
    authLoginNote:
      "请先运行一次，以便 gcloud 以所有者账户执行：",
    findProject:
      "查找项目的 ID：",
    needValidProjectId:
      "需要有效的项目 ID，项目链接和命令才会出现。",
    filtersFor:
      "{email} 的过滤器",
    filtersLabel:
      "过滤器",
    filtersHelp:
      "过滤器让代理可以列出、创建和删除 Gmail 过滤器。开启时会向 Google 请求一项额外权限（gmail.settings.basic）；创建和删除还需要 send 级别。",
  },
  hu: {
    accounts: "Fiókok",
    addAccount: "Fiók hozzáadása",
    aliasLabel: "Álnév",
    aliasPlaceholder: "álnév",
    aliasSaved: "Mentve",
    audienceErrors:
      "Google hibaoldalak: org_internal = a fiók a szervezeten kívül van, válts Külsőre; access_denied = vedd fel a fiókot tesztfelhasználóként; admin_policy_enforced = a fiók Workspace-adminisztrátorának meg kell bíznia ebben az OAuth-ügyfélben.",
    audienceHelp:
      "A Belső csak a projekt saját Workspace-szervezetének fiókjait engedi be: csak akkor válaszd, ha minden csatlakoztatandó fiók ehhez a szervezethez tartozik. Egyébként válaszd a Külsőt, és vedd fel tesztfelhasználóként minden csatlakoztatandó címet. Tesztelés módban a tokenek 7 nap után lejárnak. Az alkalmazás közzététele megszünteti a 7 napos lejáratot; a nem ellenőrzött alkalmazás Google-figyelmeztetést mutat, és legfeljebb 100 felhasználót enged be; a Tesztelés alatt hozzáadott fiókoknak közzététel után egyszer újra kell hitelesíteniük.",
    clientHelp:
      "Alkalmazástípus: Asztali alkalmazás. Töltsd le a JSON-t. Ha a link elköltözött: API-k és szolgáltatások → Hitelesítő adatok.",
    consentHint:
      "A Google a Gmail-engedélyt vagy jelölőnégyzetként kéri (pipáld be), vagy egy második képernyőn, amely szerint az alkalmazás „további hozzáférést kér” (fogadd el). Ha az első képernyő után megállsz, az csak bejelentkeztet.",
    copied: "Másolva",
    copy: "Másolás",
    copyFailed: "A másolás nem sikerült",
    createProject: "Projekt létrehozása",
    crossOrgHint:
      "A projekt Workspace-szervezetén kívüli fiókokhoz Külső célközönség kell, minden fiókot tesztfelhasználóként felvéve (3. lépés).",
    enableGmail: "Gmail API engedélyezése",
    errAborted: "A bejelentkezés megszakadt.",
    errAccessDenied:
      "A Google megtagadta a hozzáférést: a fiók nem engedélyezett tesztfelhasználó, vagy elutasították a hozzájárulást. Vedd fel a fiókot tesztfelhasználóként (3. lépés), és próbáld újra.",
    errAccountMismatch: "Másik Google-fiókkal jelentkeztél be. Hitelesíts újra a sorban látható fiókkal.",
    errAdminPolicy:
      "A fiók Google Workspace-adminisztrátora letiltja az alkalmazást. Kérd meg, hogy bízzon meg a(z) {clientId} OAuth-ügyfélben (Felügyeleti konzol → Biztonság → API-vezérlők → Alkalmazás-hozzáférés).",
    errAliasTaken: "Ezt az álnevet már egy másik fiók használja.",
    errAuthorization:
      "A Google bejelentkezési hibát jelzett. Próbáld újra; ha ismétlődik, ellenőrizd a fenti beállítási lépéseket.",
    errBadClientId: "Az ügyfél-azonosító nem .apps.googleusercontent.com végződésű (4. lépés).",
    errCallbackFailed: "A bejelentkezési visszahívás sikertelen. Próbáld újra.",
    errCancelled: "A bejelentkezés megszakítva.",
    errClientInUse:
      "A jelenlegi ügyféllel fiókok vannak csatlakoztatva. Előbb vond vissza őket, majd tölts fel másik ügyfelet.",
    errEmailUnverified:
      "A Google szerint a fiók e-mail-címe nincs ellenőrizve. Ellenőrizd a Google-nál, majd próbáld újra.",
    errGeneric:
      "A bejelentkezés sikertelen. Próbáld újra; ha továbbra is hibázik, ellenőrizd a fenti beállítási lépéseket.",
    errIdToken: "A Google bejelentkezési válasza nem ellenőrizhető. Próbáld újra.",
    errInvalidAlias: "Az álnév 1–40 betű, számjegy, '.', '_' vagy '-'.",
    errInvalidClient: "A Google nem ismeri fel az OAuth-ügyfelet. Töltsd le újra a JSON-t, és töltsd fel (5. lépés).",
    errInvalidRedirect:
      "A beillesztett cím nem a Google által küldött átirányítás. Illeszd be a böngésző címsorából a teljes URL-t.",
    errLoginFailed: "A bejelentkezés nem indult el. Próbáld újra.",
    errMissingRefresh:
      "A Google nem adott hosszú életű tokent. Vond vissza az alkalmazást a myaccount.google.com/permissions oldalon, majd add hozzá újra a fiókot.",
    errMissingSecret: "A fájlban nincs ügyféltitok. Töltsd le újra az ügyfél oldaláról (5. lépés).",
    errNotInstalled: "A fájlban nincs asztali (installed) ügyfél. Hozz létre asztali alkalmazás ügyfelet (4. lépés).",
    errNotJson: "A fájl nem érvényes JSON. Töltsd fel a letöltött client_secret_*.json fájlt (5. lépés).",
    errOrgInternal:
      "A Google letiltotta ezt a fiókot: az OAuth-alkalmazás célközönsége Belső, amely csak a projekt saját Workspace-szervezetének fiókjait engedi be. Állítsd a célközönséget Külsőre, és vedd fel ezt a fiókot tesztfelhasználóként (3. lépés).",
    errRedirectMismatch:
      "A Google elutasította az átirányítási címet. Asztali alkalmazás ügyfelet hozz létre, ne webes ügyfelet (4. lépés).",
    errScopeMissing:
      "A Google nem adta meg a Gmail-engedélyt. A Google vagy jelölőnégyzetként kéri, amelyet be kell pipálnod, vagy egy második képernyőn („további hozzáférést kér”), amelyet el kell fogadnod — az első képernyő után megállva csak bejelentkezel. Távolítsd el az alkalmazás hozzáférését a myaccount.google.com/connections oldalon, majd add hozzá újra a fiókot.",
    errStartTimeout: "A bejelentkezés nem indult el időben. Próbáld újra.",
    errStateMismatch:
      "A beillesztett átirányítás egy másik bejelentkezéshez tartozik. Kezdd újra, és ennek a bejelentkezésnek az URL-jét illeszd be.",
    errTimeout:
      "Lejárt a várakozás a Google-ra. Ha a Google hibaoldalt mutatott, jelentsd a bejelentkezési link alatti lehetőséggel.",
    errTokenExchange:
      "A Google nem váltotta be a bejelentkezési kódot. Ellenőrizd a feltöltött ügyfelet (5. lépés), és próbáld újra.",
    errWebClient: "Ez webalkalmazás-ügyfél. Hozz létre helyette asztali alkalmazás ügyfelet (4. lépés).",
    fallback2: "Ha a link elköltözött: API-k és szolgáltatások → OAuth-hozzájárulási képernyő.",
    googleErrorHelp: "Válaszd ki a Google által mutatott hibakódot:",
    googleErrorSummary: "A Google hibát mutatott, ahelyett hogy visszairányított volna?",
    level: "Szint",
    levelHelp:
      "A szinteket ez a bővítmény érvényesíti, nem a Google: a token a Google által megadott összes hatókört hordozza (a draft szintű írási jog technikailag küldhetne is), így a szint azt korlátozza, mit tehetnek az ügynök eszközei. A dashboard bármely munkamenete használhat minden fiókot a saját szintjén belül.",
    loading: "Betöltés…",
    newLevel: "Az új fiók szintje",
    noAccounts: "Nincs csatlakoztatott fiók.",
    openAudience: "Célközönség megnyitása",
    openBranding: "Arculat megnyitása",
    openClients: "Ügyfél létrehozása",
    projectId: "Projektazonosító",
    reauth: "Újrahitelesítés",
    reportOther: "Valami más",
    revoke: "Visszavonás",
    revokeConfirm:
      "Visszavonod: {email}? A dashboard elfelejti a fiókot, és kéri a Google-t a hozzáférés visszavonására.",
    revokedOk: "{email} eltávolítva, a hozzáférés a Google-nál visszavonva.",
    revokeManual:
      "{email} helyben eltávolítva, de a Google nem volt elérhető. Vond vissza a hozzáférést a myaccount.google.com/permissions oldalon.",
    setup: "Google Cloud beállítás",
    statusOk: "Csatlakoztatva",
    statusReauth: "Újrahitelesítés szükséges",
    stepDone: "kész",
    aliasFor: "{email} aliasa",
    levelFor: "{email} szintje",
    revokeFor: "{email} visszavonása",
    reauthFor: "{email} újrahitelesítése",
    addAccountDisabled: "Töltse fel az OAuth-kliens JSON-t (fent az 5. lépés), hogy ez elérhető legyen.",
    step1: "1. Google Cloud projekt + Gmail API",
    step2: "2. Arculat",
    step3: "3. Célközönség + tesztfelhasználók",
    step4: "4. Asztali OAuth-ügyfél",
    step5: "5. client_secret_*.json feltöltése",
    step6: "6. Próba-bejelentkezés",
    step6Help: "Add hozzá lent az első fiókot — ez a próba-bejelentkezés.",
    summaryClient: "✓ {clientId}",
    summaryNotConfigured: "nincs beállítva",
    summaryProject: "✓ projekt: {projectId}",
    testingBadge: "teszt: 7 nap",
    testingHint: "Tesztelés módú alkalmazás: a Google 7 nap után lejártatja ezt a hozzáférést.",
    tierDraft: "olvasás + piszkozatok",
    tierReadonly: "levelek olvasása",
    tierSend: "olvasás, piszkozat, küldés, válasz, címkék, archiválás, kuka",
    title: "Gmail",
    uploadLabel: "OAuth-ügyfél JSON feltöltése",
    withGcloud: "gcloud-dal (futtasd magad):",
    withoutGcloud: "gcloud nélkül:",
    projectModeLegend:
      "Projekt",
    projectModeNew:
      "Új projekt létrehozása",
    projectModeExisting:
      "Meglévő projekt használata",
    projectIdHint:
      "A Google Cloud projekt azonosítója, nem a megjelenített neve: kisbetűk, számok és kötőjelek, például my-gmail-agent. A konzol projektlistája mindkettőt mutatja; az azonosító az ID oszlopban van.",
    openProjectList:
      "Projektlista megnyitása",
    ownerAccount:
      "Tulajdonos fiók (nem kötelező)",
    ownerHint:
      "A projektet birtokló Google-fiók. A konzol-linkek és a gcloud-parancsok ekkor ezzel a fiókkal járnak el a böngésző alapértelmezett fiókja helyett.",
    errOwnerInvalid:
      "Adj meg teljes e-mail-címet, például you@gmail.com.",
    errSetupSave:
      "A projektazonosítót nem sikerült menteni, ezért a feltöltés nem indult el. Próbáld újra (1. lépés).",
    errProjectLooksLikeName:
      "Ez a projekt nevének tűnik. A varázslónak a projektazonosító kell (kisbetűs, például pidashboard-510015): nyisd meg a projektlistát, és másold ki az ID oszlopot.",
    errProjectInvalid:
      "A projektazonosító 6–30 karakter: kisbetűk, számok és kötőjelek, betűvel kezdődik, és nem végződik kötőjellel.",
    projectMismatch:
      "A feltöltött ügyfél a(z) {json} projekthez tartozik, de a mentett projektazonosító {saved}.",
    projectMismatchUse:
      "{id} használata",
    authLoginNote:
      "Futtasd le egyszer előbb, hogy a gcloud a tulajdonos fiókkal járjon el:",
    findProject:
      "A projekt azonosítójának megkeresése:",
    needValidProjectId:
      "Érvényes projektazonosító kell ahhoz, hogy a projekt linkjei és parancsai megjelenjenek.",
    filtersFor:
      "{email} szűrői",
    filtersLabel:
      "Szűrők",
    filtersHelp:
      "A szűrők lehetővé teszik, hogy az ügynökök Gmail-szűrőket listázzanak, hozzanak létre és töröljenek. A bekapcsolás egy plusz engedélyt kér a Google-tól (gmail.settings.basic); a létrehozáshoz és a törléshez send szint is kell.",
  },
};
