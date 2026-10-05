/* team-app mockup. Vanilla JS, no deps. Renders the SPA screens of D10 from mock data.
   Persona content (names, descriptions, transcript) is user data: never translated. */
"use strict";

// ── i18n: HU default, EN toggle, identical key sets (asserted by ux-probe) ──
const I18N = {
  hu: {
    "app.name": "AI Csapat", "nav.team": "Csapat", "lang.group": "Nyelv",
    "theme.toLight": "Váltás világos témára", "theme.toDark": "Váltás sötét témára",
    "user.signOut": "Kijelentkezés", "user.local": "Helyi operátor", "user.admin": "admin",
    "grid.title": "Csapat", "grid.subtitle": "Ügynökeid, akik emlékeznek a korábbi beszélgetésekre.",
    "grid.new": "Új persona", "grid.shared": "Közös sablonok", "grid.own": "Saját ügynökök",
    "grid.loading": "Ügynökök betöltése…", "grid.error": "Az ügynökök listája nem tölthető be.",
    "grid.errorDetail": "A dashboard nem válaszolt. A kártyák az újrapróbálás után frissülnek.",
    "grid.retry": "Újrapróbálás", "grid.emptyOwn": "Még nincs saját ügynököd. Készíts egyet, vagy másolj le egy közös sablont a menüjéből.",
    "grid.emptyOwnCta": "Saját persona létrehozása", "grid.count": "{n} ügynök",
    "status.new": "Új", "status.sleeping": "Alszik", "status.running": "Fut", "status.busy": "Dolgozik",
    "status.retired": "Visszavonult", "status.unavailable": "Nem elérhető",
    "scope.shared": "Közös", "scope.private": "Saját", "role.leader": "Vezető", "role.member": "Tag",
    "model.default": "alapértelmezett modell", "tools.unconfined": "Nem korlátozott",
    "card.talk": "Beszélgetés", "card.talkTo": "Beszélgetés vele: {name}", "card.more": "További műveletek: {name}",
    "card.retiredNote": "A persona törölve lett. A korábbi beszélgetés megmaradt.",
    "card.unavailableNote": "Shell (bash) jogú persona; csak egyfelhasználós módban fut.",
    "card.stale": "A persona frissült. Újraindítás után érvényes; a beszélgetés megmarad.",
    "card.restart": "Újraindítás a frissítéshez",
    "menu.edit": "Szerkesztés", "menu.fork": "Másolat a saját ügynökeim közé", "menu.delete": "Persona törlése",
    "menu.reset": "Beszélgetés törlése", "menu.removeRecord": "Bejegyzés eltávolítása", "menu.restart": "Újraindítás",
    "dlg.cancel": "Mégse",
    "dlg.delete.title": "Törlöd: {name}?", "dlg.delete.body": "A persona végleg törlődik. A futó és korábbi beszélgetések megmaradnak, a kártyák „Visszavonult” állapotba kerülnek.",
    "dlg.delete.ok": "Persona törlése",
    "dlg.reset.title": "Törlöd a beszélgetést: {name}?", "dlg.reset.body": "Az ügynök tiszta lappal indul legközelebb. A munkaterület fájljai megmaradnak.",
    "dlg.reset.ok": "Beszélgetés törlése",
    "toast.restarted": "Újraindítva. A következő üzenet már az új personával fut.",
    "toast.deleted": "Persona törölve.", "toast.reset": "Beszélgetés törölve.", "toast.saved": "Mentve.",
    "toast.savedStale": "Mentve. A futó beszélgetés az újraindítás után használja.",
    "toast.forked": "Másolat kész. Szerkeszd és mentsd.", "toast.reconnected": "Újra kapcsolódva.",
    "ed.new": "Új persona", "ed.edit": "Persona szerkesztése", "ed.forkFrom": "Másolat innen: {name}. Mentés után a saját ügynökeid között lesz.",
    "ed.back": "Vissza a csapathoz", "ed.applyNote": "A változás a következő munkamenet-indításkor lép életbe. Futó beszélgetésnél a kártyán megjelenik az „Újraindítás a frissítéshez” gomb.",
    "ed.errSummary": "A mentés nem sikerült", "ed.name": "Név", "ed.nameHint": "Ez jelenik meg a kártyán.",
    "ed.desc": "Rövid leírás", "ed.descHint": "Mire való ez az ügynök? Egy-két mondat.",
    "ed.avatar": "Avatar", "ed.avatarInitials": "Monogram", "av.compass": "Iránytű", "av.hex": "Kocka", "av.lens": "Nagyító", "av.quill": "Toll", "av.bars": "Oszlopok", "av.wave": "Hullám", "av.spark": "Szikra", "av.leaf": "Levél", "ed.role": "Szerep",
    "ed.roleLeader": "Vezető", "ed.roleLeaderDesc": "Jelvény a kártyán.", "ed.roleMember": "Tag", "ed.roleMemberDesc": "Alapértelmezett.",
    "ed.model": "Modell", "ed.modelDefault": "Alapértelmezett (a dashboard beállítása)",
    "ed.tools": "Eszközök", "ed.toolsChat": "Csak olvasás", "ed.toolsChatDesc": "Fájlokat olvas és keres a kiválasztott mappában.",
    "ed.toolsFiles": "Fájlok", "ed.toolsFilesDesc": "Olvas és ír is, csak a kiválasztott mappában.",
    "ed.toolsFull": "Teljes (bash)", "ed.toolsFullDesc": "Shell parancsokat futtat. Nem korlátozható a munkaterületre.",
    "ed.toolsFullAbsentPrivate": "A Teljes (bash) csak közös sablonnál választható.",
    "ed.toolsFullAbsentMulti": "A Teljes (bash) csak egyfelhasználós módban választható.",
    "ed.skills": "Képességek", "ed.skillsHint": "Az adminisztrátor által engedélyezett képességek közül.",
    "ed.instr": "Utasítások", "ed.instrHint": "Markdown. Hogyan dolgozzon, milyen hangnemben, mire figyeljen.",
    "ed.scope": "Hatókör", "ed.scopeShared": "Közös sablon", "ed.scopeSharedDesc": "Mindenki látja; mindenkinek saját beszélgetése lesz vele.",
    "ed.scopePrivate": "Saját", "ed.scopePrivateDesc": "Csak te látod.", "ed.scopeFixed": "Saját (csak te látod)",
    "ed.save": "Mentés", "ed.saving": "Mentés…", "ed.cancel": "Mégse", "ed.delete": "Persona törlése",
    "ed.counter": "{n} / {max}", "ed.bytes": "{n} / {max} bájt",
    "err.name_too_long": "A név legfeljebb 60 karakter lehet.", "err.name_required": "Add meg a nevet.",
    "err.description_too_long": "A leírás legfeljebb 280 karakter lehet.",
    "err.instructions_too_large": "Az utasítások legfeljebb 32 768 bájtosak lehetnek.",
    "target.ws": "Saját munkaterület", "target.label": "Itt dolgozik", "target.shared": "Közös mappa a csapattal",
    "target.mine": "Csak a tiéd", "target.unavailable": "Nem elérhető: a mappa hiányzik", "target.switch": "Projekt: {name}. Váltás",
    "target.menu": "Projekt kiválasztása", "cv.workspaceIn": "Csak ebben a mappában dolgozik: {name}",
    "cv.projectUnavailable": "Ez a projekt most nem érhető el, vagy nincs hozzá jogod.",
    "target.switched": "Kiválasztva: {name}", "grid.subtitleTarget": "A csapat itt: {name}",
    "grid.emptyTarget": "Ehhez a projekthez ({name}) még nincs ügynök rendelve.", "grid.emptyWs": "A saját munkaterületedhez még nincs ügynök rendelve.",
    "grid.emptyAdmin": "Közös sablont a persona szerkesztőjében, a Projektek mezőben rendelhetsz ide.", "grid.emptyCta": "Saját persona ide",
    "card.convOne": "1 beszélgetés", "card.convMany": "{n} beszélgetés", "card.noConv": "Még nincs beszélgetés",
    "card.new": "Új", "card.newTo": "Új beszélgetés vele: {name}", "card.openList": "Beszélgetések ({n})",
    "card.unassignedNote": "Ehhez a projekthez már nincs hozzárendelve. A beszélgetések archiválhatók vagy törölhetők.",
    "card.retiredNote": "A persona törölve lett. A beszélgetések archiválhatók vagy törölhetők.",
    "card.fullNote": "Shell (bash) jogú persona; csak egyfelhasználós módban fut.",
    "time.now": "most", "time.min": "{n} perce", "time.hour": "{n} órája", "time.day": "{n} napja",
    "cv.list": "Beszélgetések", "cv.new": "Új beszélgetés", "cv.limit": "Elérted a {max} aktív beszélgetést. Archiválj egyet az újhoz.",
    "cv.showArchived": "Archivált ({n})", "cv.showActive": "Aktív beszélgetések", "cv.archivedTitle": "Archivált beszélgetések",
    "cv.emptyList": "Még nincs beszélgetés ezzel az ügynökkel itt.", "cv.emptyArchived": "Nincs archivált beszélgetés.",
    "cv.pick": "Válassz beszélgetést, vagy kezdj újat.", "cv.backList": "Beszélgetések", "cv.convMenu": "Beszélgetés műveletei: {title}",
    "cv.untitled": "Új beszélgetés", "cv.staleShort": "frissítendő", "cv.startHint": "Új beszélgetés vele: {name}. Írd le, miben segítsen.",
    "cv.archivedBanner": "Archivált beszélgetés: csak olvasható. Állítsd vissza a folytatáshoz.",
    "cv.readOnly.retired": "A persona törölve lett, ez a beszélgetés nem folytatható.",
    "cv.readOnly.unassigned": "Ez az ügynök már nincs ehhez a projekthez rendelve, a beszélgetés nem folytatható.",
    "cv.readOnly.full": "Shell (bash) jogú persona; több felhasználós módban nem fut.",
    "cv.convNotFound": "Ez a beszélgetés nem található.",
    "fold.sidebar": "Dashboard oldalsáv (minta)", "fold.note": "Dashboard oldalsáv: csak a Csapat-sor és a mappa menü Csapat-elemei jönnek a pluginból.", "fold.menu": "Mappa műveletek: {name}", "fold.teamRow": "Csapat · {n} ügynök · {a} aktív", "fold.open": "Csapat", "fold.settings": "Csapat beállításai…", "fold.disable": "Csapat kikapcsolása", "fold.enable": "Csapat bekapcsolása ehhez a mappához", "fold.pin": "Rögzítés", "fold.back": "Vissza: {name}", "fold.locked": "Projekt: {name} (ehhez a mappához kötve)", "fold.full": "Teljes csapat", "fold.dlgTitle": "Csapat bekapcsolása: {name}", "fold.dlgSettings": "Csapat beállításai: {name}", "fold.name": "Projekt neve", "fold.nameHint": "A felhasználók ezt látják a projektválasztóban.", "fold.who": "Kik használhatják", "fold.everyone": "Mindenki, aki be van jelentkezve", "fold.selected": "Kiválasztott felhasználók", "fold.usersHint": "Azok szerepelnek itt, akik már megnyitották a csapat alkalmazást.", "fold.ctx": "A mappa AGENTS.md és CLAUDE.md fájlját is megkapják az ügynökök", "fold.ctxHint": "Fájlonként legfeljebb 64 KiB, nem megbízható bemenetként kezelve.", "fold.ok": "Bekapcsolás", "fold.save": "Mentés", "fold.errName": "Adj nevet a projektnek.", "fold.errUsers": "Válassz legalább egy felhasználót, vagy engedd mindenkinek.", "fold.disTitle": "Csapat kikapcsolása: {name}?", "fold.disBody": "A beszélgetések és a fájlok megmaradnak; ha újra bekapcsolod, visszajönnek.", "fold.disOk": "Kikapcsolás", "fold.pick": "Válassz mappát az oldalsávban.", "toast.enabled": "Csapat bekapcsolva: {name}", "toast.disabled": "Csapat kikapcsolva.", "toast.projSaved": "Beállítások mentve.", "toast.toFolder": "Vissza a mappához a dashboardon.", "grid.addAgents": "Ügynökök hozzáadása", "dlg.add.title": "Ügynökök hozzáadása: {name}", "dlg.add.ok": "Hozzáadás", "dlg.add.none": "Minden közös sablon már ide van rendelve.", "toast.added": "{n} ügynök hozzáadva.",
    "menu.openDash": "Megnyitás a dashboardon", "toast.openDash": "A dashboard munkamenet-nézete nyílik (host.openSession).", "host.back": "Munkamenetek", "host.backTo": "Vissza: Munkamenetek", "host.standalone": "Önálló ablak", "toast.standalone": "Megnyílik a /apps/team/… külön ablakban (openStandalone).", "host.crumb": "Útvonal", "fold.global": "Csapat", "fold.slotNote": "kért globális slot", 
    "menu.rename": "Átnevezés", "menu.archive": "Archiválás", "menu.restore": "Visszaállítás", "menu.deleteConv": "Beszélgetés törlése",
    "dlg.rename.title": "Beszélgetés átnevezése", "dlg.rename.label": "Cím", "dlg.rename.hint": "1–80 karakter.", "dlg.rename.ok": "Mentés",
    "dlg.deleteConv.title": "Törlöd: {title}?", "dlg.deleteConv.body": "A beszélgetés eltűnik a listából, és többé nem nyitható meg az alkalmazásban. Az átirat fájlja a szerveren megmarad.",
    "dlg.deleteConv.ok": "Beszélgetés törlése", "err.title_invalid": "A cím 1–80 karakter lehet.", "err.projects_required": "Válassz legalább egy helyet.",
    "toast.archived": "Archiválva.", "toast.restoredConv": "Visszaállítva.", "toast.renamed": "Átnevezve.", "toast.deletedConv": "Beszélgetés törölve.",
    "ed.projects": "Projektek", "ed.projectsHint": "Hol jelenjen meg ez az ügynök. Legalább egy kell.",
    "cv.back": "Csapat", "cv.more": "Beszélgetés műveletei", "cv.workspace": "Csak a kiválasztott mappában dolgozik",
    "cv.toolsChat": "Csak olvasás", "cv.toolsFiles": "Fájlok", "cv.toolsFull": "Teljes (bash)",
    "cv.spawn": "Ügynök indítása…", "cv.resume": "Előző beszélgetés folytatása…",
    "cv.reconnect": "Megszakadt a kapcsolat. Újracsatlakozás…", "cv.reconnectDetail": "Az üzenetek nem vesznek el; a beszélgetés ott folytatódik, ahol abbamaradt.",
    "cv.spawn_timeout": "Az ügynök nem indult el 30 másodpercen belül.", "cv.spawn_timeoutDetail": "Próbáld újra. Ha ismét előfordul, szólj az adminisztrátornak.",
    "cv.guard_unavailable": "Az ügynök nem indítható: a biztonsági őr bővítmény nem elérhető.", "cv.guard_unavailableDetail": "Ez szerveroldali beállítási hiba. Szólj az adminisztrátornak.",
    "cv.retry": "Újrapróbálás", "cv.stale": "A persona frissült. Indítsd újra az ügynököt, hogy az új beállítással folytassa; a beszélgetés megmarad.",
    "cv.restart": "Újraindítás", "cv.history": "Folytatva",
    "cv.placeholder": "Üzenet neki: {name}", "cv.inputLabel": "Üzenet", "cv.send": "Küldés", "cv.stop": "Leállítás",
    "cv.thinking": "Dolgozik…", "cv.hint": "Enter: küldés · Shift+Enter: új sor", "cv.notFound": "Ez az ügynök nem található.",
    "auth.title": "Jelentkezz be a csapatodhoz", "auth.body": "A szervezeted fiókjával lépsz be. Az ügynökeid és beszélgetéseid csak neked látszanak.",
    "auth.signIn": "Bejelentkezés", "auth.redirecting": "Átirányítás a bejelentkezéshez…",
    "auth.unavailable": "A bejelentkezés most nem érhető el.", "auth.unavailableDetail": "A dashboard bejelentkezési adatai nem tölthetők be. Ellenőrizd a kapcsolatot, majd próbáld újra.",
    "auth.notAdmitted": "Ez a dashboard nem fogadja ezt a címet.",
    "auth.notAdmittedDetail": "Egyfelhasználós módban (bejelentkezés nélkül) az alkalmazás csak a dashboard gépéről vagy egy megbízható hálózatból (trustedNetworks) érhető el. Nyisd meg onnan, vagy kapcsold be a bejelentkezést.",
  },
  en: {
    "app.name": "AI Team", "nav.team": "Team", "lang.group": "Language",
    "theme.toLight": "Switch to light theme", "theme.toDark": "Switch to dark theme",
    "user.signOut": "Sign out", "user.local": "Local operator", "user.admin": "admin",
    "grid.title": "Team", "grid.subtitle": "Your agents, who remember earlier conversations.",
    "grid.new": "New persona", "grid.shared": "Shared templates", "grid.own": "My agents",
    "grid.loading": "Loading agents…", "grid.error": "The agent list could not be loaded.",
    "grid.errorDetail": "The dashboard did not respond. Cards refresh after a retry.",
    "grid.retry": "Retry", "grid.emptyOwn": "You have no agents of your own yet. Create one, or copy a shared template from its menu.",
    "grid.emptyOwnCta": "Create my own persona", "grid.count": "{n} agents",
    "status.new": "New", "status.sleeping": "Sleeping", "status.running": "Running", "status.busy": "Working",
    "status.retired": "Retired", "status.unavailable": "Unavailable",
    "scope.shared": "Shared", "scope.private": "Mine", "role.leader": "Leader", "role.member": "Member",
    "model.default": "default model", "tools.unconfined": "Unconfined",
    "card.talk": "Conversation", "card.talkTo": "Talk to {name}", "card.more": "More actions: {name}",
    "card.retiredNote": "This persona was deleted. The earlier conversation is kept.",
    "card.unavailableNote": "Shell (bash) persona; runs only in single-user mode.",
    "card.stale": "Persona updated. Applies after a restart; the conversation is kept.",
    "card.restart": "Restart to apply",
    "menu.edit": "Edit", "menu.fork": "Copy to my agents", "menu.delete": "Delete persona",
    "menu.reset": "Clear conversation", "menu.removeRecord": "Remove entry", "menu.restart": "Restart",
    "dlg.cancel": "Cancel",
    "dlg.delete.title": "Delete {name}?", "dlg.delete.body": "The persona is deleted for good. Running and earlier conversations are kept and their cards become “Retired”.",
    "dlg.delete.ok": "Delete persona",
    "dlg.reset.title": "Clear the conversation with {name}?", "dlg.reset.body": "The agent starts fresh next time. Files in its workspace are kept.",
    "dlg.reset.ok": "Clear conversation",
    "toast.restarted": "Restarted. Your next message uses the updated persona.",
    "toast.deleted": "Persona deleted.", "toast.reset": "Conversation cleared.", "toast.saved": "Saved.",
    "toast.savedStale": "Saved. The running conversation picks it up after a restart.",
    "toast.forked": "Copy ready. Edit it and save.", "toast.reconnected": "Reconnected.",
    "ed.new": "New persona", "ed.edit": "Edit persona", "ed.forkFrom": "Copy of {name}. After saving it is one of your agents.",
    "ed.back": "Back to team", "ed.applyNote": "Changes apply the next time the session starts. For a running conversation, the card shows “Restart to apply”.",
    "ed.errSummary": "Could not save", "ed.name": "Name", "ed.nameHint": "Shown on the card.",
    "ed.desc": "Short description", "ed.descHint": "What is this agent for? One or two sentences.",
    "ed.avatar": "Avatar", "ed.avatarInitials": "Initials", "av.compass": "Compass", "av.hex": "Cube", "av.lens": "Magnifier", "av.quill": "Pen", "av.bars": "Bars", "av.wave": "Wave", "av.spark": "Spark", "av.leaf": "Leaf", "ed.role": "Role",
    "ed.roleLeader": "Leader", "ed.roleLeaderDesc": "Badge on the card.", "ed.roleMember": "Member", "ed.roleMemberDesc": "Default.",
    "ed.model": "Model", "ed.modelDefault": "Default (dashboard setting)",
    "ed.tools": "Tools", "ed.toolsChat": "Read only", "ed.toolsChatDesc": "Reads and searches files in the selected folder.",
    "ed.toolsFiles": "Files", "ed.toolsFilesDesc": "Reads and writes, only inside the selected folder.",
    "ed.toolsFull": "Full (bash)", "ed.toolsFullDesc": "Runs shell commands. Cannot be confined to the workspace.",
    "ed.toolsFullAbsentPrivate": "Full (bash) is available only for shared templates.",
    "ed.toolsFullAbsentMulti": "Full (bash) is available only in single-user mode.",
    "ed.skills": "Skills", "ed.skillsHint": "From the skills your administrator allows.",
    "ed.instr": "Instructions", "ed.instrHint": "Markdown. How it should work, its tone, what to watch for.",
    "ed.scope": "Scope", "ed.scopeShared": "Shared template", "ed.scopeSharedDesc": "Everyone sees it; each person gets their own conversation.",
    "ed.scopePrivate": "Mine", "ed.scopePrivateDesc": "Only you see it.", "ed.scopeFixed": "Mine (only you see it)",
    "ed.save": "Save", "ed.saving": "Saving…", "ed.cancel": "Cancel", "ed.delete": "Delete persona",
    "ed.counter": "{n} / {max}", "ed.bytes": "{n} / {max} bytes",
    "err.name_too_long": "The name can be at most 60 characters.", "err.name_required": "Enter a name.",
    "err.description_too_long": "The description can be at most 280 characters.",
    "err.instructions_too_large": "Instructions can be at most 32,768 bytes.",
    "target.ws": "Private workspace", "target.label": "Works in", "target.shared": "Shared with the team",
    "target.mine": "Only yours", "target.unavailable": "Unavailable: folder missing", "target.switch": "Project: {name}. Switch",
    "target.menu": "Choose project", "cv.workspaceIn": "Works only inside: {name}",
    "cv.projectUnavailable": "This project is not available right now, or you have no access to it.",
    "target.switched": "Selected: {name}", "grid.subtitleTarget": "The team in {name}",
    "grid.emptyTarget": "No agents are assigned to {name} yet.", "grid.emptyWs": "No agents are assigned to your own workspace yet.",
    "grid.emptyAdmin": "Admins assign shared templates here in the persona editor's Projects field.", "grid.emptyCta": "Create my persona here",
    "card.convOne": "1 conversation", "card.convMany": "{n} conversations", "card.noConv": "No conversations yet",
    "card.new": "New", "card.newTo": "New conversation with {name}", "card.openList": "Conversations ({n})",
    "card.unassignedNote": "No longer assigned to this project. Its conversations can be archived or deleted.",
    "card.retiredNote": "This persona was deleted. Its conversations can be archived or deleted.",
    "card.fullNote": "Shell (bash) persona; runs only in single-user mode.",
    "time.now": "just now", "time.min": "{n} min ago", "time.hour": "{n} h ago", "time.day": "{n} d ago",
    "cv.list": "Conversations", "cv.new": "New conversation", "cv.limit": "You have {max} active conversations. Archive one to start another.",
    "cv.showArchived": "Archived ({n})", "cv.showActive": "Active conversations", "cv.archivedTitle": "Archived conversations",
    "cv.emptyList": "No conversations with this agent here yet.", "cv.emptyArchived": "No archived conversations.",
    "cv.pick": "Pick a conversation, or start a new one.", "cv.backList": "Conversations", "cv.convMenu": "Conversation actions: {title}",
    "cv.untitled": "New conversation", "cv.staleShort": "needs restart", "cv.startHint": "New conversation with {name}. Say what you need.",
    "cv.archivedBanner": "Archived conversation: read only. Restore it to continue.",
    "cv.readOnly.retired": "This persona was deleted; the conversation cannot continue.",
    "cv.readOnly.unassigned": "This agent is no longer assigned to this project; the conversation cannot continue.",
    "cv.readOnly.full": "Shell (bash) persona; it does not run in multi-user mode.",
    "cv.convNotFound": "This conversation was not found.",
    "fold.sidebar": "Dashboard sidebar (mock)", "fold.note": "Dashboard sidebar: only the Team row and the folder menu's Team items come from the plugin.", "fold.menu": "Folder actions: {name}", "fold.teamRow": "Team · {n} agents · {a} active", "fold.open": "Team", "fold.settings": "Team settings…", "fold.disable": "Turn team off", "fold.enable": "Turn team on for this folder", "fold.pin": "Pin", "fold.back": "Back: {name}", "fold.locked": "Project: {name} (bound to this folder)", "fold.full": "Full team", "fold.dlgTitle": "Turn team on: {name}", "fold.dlgSettings": "Team settings: {name}", "fold.name": "Project name", "fold.nameHint": "Users see this in the project selector.", "fold.who": "Who can use it", "fold.everyone": "Everyone signed in", "fold.selected": "Selected users", "fold.usersHint": "Lists people who have opened the team app before.", "fold.ctx": "Also give agents the folder's AGENTS.md and CLAUDE.md", "fold.ctxHint": "Up to 64 KiB each, treated as untrusted input.", "fold.ok": "Turn on", "fold.save": "Save", "fold.errName": "Give the project a name.", "fold.errUsers": "Pick at least one user, or allow everyone.", "fold.disTitle": "Turn team off for {name}?", "fold.disBody": "Conversations and files are kept; turning it back on restores them.", "fold.disOk": "Turn off", "fold.pick": "Pick a folder in the sidebar.", "toast.enabled": "Team on: {name}", "toast.disabled": "Team turned off.", "toast.projSaved": "Settings saved.", "toast.toFolder": "Back to the folder in the dashboard.", "grid.addAgents": "Add agents", "dlg.add.title": "Add agents to {name}", "dlg.add.ok": "Add", "dlg.add.none": "Every shared template is already assigned here.", "toast.added": "{n} agents added.",
    "menu.openDash": "Open in dashboard", "toast.openDash": "Opens the dashboard session view (host.openSession).", "host.back": "Sessions", "host.backTo": "Back to Sessions", "host.standalone": "Open standalone", "toast.standalone": "Opens /apps/team/… in its own window (openStandalone).", "host.crumb": "Breadcrumb", "fold.global": "Team", "fold.slotNote": "requested global slot", 
    "menu.rename": "Rename", "menu.archive": "Archive", "menu.restore": "Restore", "menu.deleteConv": "Delete conversation",
    "dlg.rename.title": "Rename conversation", "dlg.rename.label": "Title", "dlg.rename.hint": "1–80 characters.", "dlg.rename.ok": "Save",
    "dlg.deleteConv.title": "Delete {title}?", "dlg.deleteConv.body": "The conversation leaves the list and can no longer be opened in the app. Its transcript file stays on the server.",
    "dlg.deleteConv.ok": "Delete conversation", "err.title_invalid": "The title must be 1–80 characters.", "err.projects_required": "Pick at least one place.",
    "toast.archived": "Archived.", "toast.restoredConv": "Restored.", "toast.renamed": "Renamed.", "toast.deletedConv": "Conversation deleted.",
    "ed.projects": "Projects", "ed.projectsHint": "Where this agent appears. At least one.",
    "cv.back": "Team", "cv.more": "Conversation actions", "cv.workspace": "Works only inside the selected folder",
    "cv.toolsChat": "Read only", "cv.toolsFiles": "Files", "cv.toolsFull": "Full (bash)",
    "cv.spawn": "Starting the agent…", "cv.resume": "Resuming the earlier conversation…",
    "cv.reconnect": "Connection lost. Reconnecting…", "cv.reconnectDetail": "No messages are lost; the conversation continues where it stopped.",
    "cv.spawn_timeout": "The agent did not start within 30 seconds.", "cv.spawn_timeoutDetail": "Try again. If it happens again, tell your administrator.",
    "cv.guard_unavailable": "The agent cannot start: the safety guard extension is unavailable.", "cv.guard_unavailableDetail": "This is a server configuration problem. Tell your administrator.",
    "cv.retry": "Retry", "cv.stale": "Persona updated. Restart the agent to continue with the new settings; the conversation is kept.",
    "cv.restart": "Restart", "cv.history": "Resumed",
    "cv.placeholder": "Message {name}", "cv.inputLabel": "Message", "cv.send": "Send", "cv.stop": "Stop",
    "cv.thinking": "Working…", "cv.hint": "Enter: send · Shift+Enter: new line", "cv.notFound": "This agent was not found.",
    "auth.title": "Sign in to your team", "auth.body": "Use your organisation account. Your agents and conversations are visible only to you.",
    "auth.signIn": "Sign in", "auth.redirecting": "Redirecting to sign-in…",
    "auth.unavailable": "Sign-in is unavailable right now.", "auth.unavailableDetail": "The dashboard's sign-in details could not be loaded. Check the connection and try again.",
    "auth.notAdmitted": "This dashboard does not accept this address.",
    "auth.notAdmittedDetail": "In single-user mode (no sign-in) the app works only from the dashboard machine or a trusted network (trustedNetworks). Open it from there, or turn on sign-in.",
  },
};

// ── Icons (authored stroke paths) + avatar gallery (original geometric marks) ──
const ICON = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  person: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
  warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  refresh: '<path d="M21 4v6h-6M20.5 15a9 9 0 1 1-2.1-9.4L21 10"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  fork: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  openExt: '<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  home: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
};
const GALLERY = {
  compass: { tint: "purple", svg: '<circle cx="12" cy="12" r="9"/><path d="M12 6l2.5 6-2.5 6-2.5-6z"/>' },
  hex: { tint: "blue", svg: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>' },
  lens: { tint: "orange", svg: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/>' },
  quill: { tint: "green", svg: '<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3"/>' },
  bars: { tint: "orange", svg: '<path d="M5 20V11M12 20V4M19 20v-6M3 20h18"/>' },
  wave: { tint: "blue", svg: '<path d="M3 10c3-4 6-4 9 0s6 4 9 0M3 16c3-4 6-4 9 0s6 4 9 0"/>' },
  spark: { tint: "purple", svg: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>' },
  leaf: { tint: "green", svg: '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7"/>' },
};
const MODELS = ["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5", "gemini-2.5-pro"];
const SKILLS = [
  { id: "magyar-helyesiras", desc: { hu: "Magyar helyesírás és stílus", en: "Hungarian spelling and style" } },
  { id: "kod-review", desc: { hu: "Kódbírálati ellenőrzőlista", en: "Code review checklist" } },
  { id: "csv-elemzes", desc: { hu: "CSV tisztítás és összesítés", en: "CSV cleaning and aggregation" } },
  { id: "release-notes", desc: { hu: "Kiadási jegyzet sablon", en: "Release notes template" } },
];

// ── Mock data (shapes of GET /projects, GET /personas, GET /agents?project=, GET …/conversations) ──
// Admin-configured projects (D13). `unavailable` = path no longer validates.
const PROJECTS = [
  { id: "billing", name: "billing-api", path: "/repo/billing-api", source: "config" },
  { id: "crm", name: "crm-web", path: "/repo/crm-web", source: "folder", users: "*" },
  { id: "archiv", name: "régi-portál", path: "/srv/regi-portal", source: "config", unavailable: true },
];
const PERSONAS = [
  { key: "shared:projektvezeto", scope: "shared", name: "Projektvezető", description: "Feladatokra bontja a kéréseket, követi a határidőket, és összefoglalja, ki min dolgozik.", avatar: { kind: "gallery", id: "compass" }, role: "leader", model: "claude-sonnet-4-5", tools: "chat", skills: [], instructions: "Légy tömör. Minden válasz végén legyen egy teendőlista.", projects: ["billing", "crm", "_ws"] },
  { key: "shared:backend", scope: "shared", name: "Backend fejlesztő", description: "TypeScript és Node szolgáltatások: API-k, migrációk és tesztek a kiválasztott projektben.", avatar: { kind: "gallery", id: "hex" }, role: "member", model: "gpt-5", tools: "files", skills: ["kod-review"], instructions: "Írj tesztet először. Ne vezess be új függőséget kérdezés nélkül.", projects: ["billing", "crm"] },
  { key: "shared:kodbiralo", scope: "shared", name: "Kódbíráló", description: "Átnézi a diffet: hibák, olvashatóság, tesztlefedettség. Fájlt nem módosít.", avatar: { kind: "gallery", id: "lens" }, role: "member", tools: "chat", skills: ["kod-review"], instructions: "Súlyosság szerint rendezd a megjegyzéseket.", projects: ["billing"] },
  { key: "shared:szovegiro", scope: "shared", name: "Szövegíró", description: "Termékoldalak, hírlevelek és kiadási jegyzetek magyarul és angolul.", avatar: { kind: "gallery", id: "quill" }, role: "member", model: "claude-haiku-4-5", tools: "files", skills: ["magyar-helyesiras", "release-notes"], instructions: "Magázó hangnem, rövid bekezdések.", projects: ["_ws", "crm"] },
  { key: "shared:rendszergazda", scope: "shared", name: "Rendszergazda", description: "Shell parancsokat futtat a gépen: csomagtelepítés, naplók, szolgáltatások újraindítása.", avatar: { kind: "gallery", id: "spark" }, role: "member", model: "claude-sonnet-4-5", tools: "full", skills: [], instructions: "Minden parancs előtt írd le, mit csinál.", projects: ["_ws"] },
  { key: "private:szovegiro", scope: "private", name: "Szövegíró (tegező)", description: "A közös Szövegíró másolata: tegező hangnem, a cég stílusútmutatója szerint.", avatar: { kind: "initials" }, role: "member", model: "claude-haiku-4-5", tools: "files", skills: ["magyar-helyesiras"], forkedFrom: "shared:szovegiro", instructions: "Tegező hangnem. Maximum három mondat bekezdésenként.", projects: ["_ws"] },
  { key: "private:adatelemzo", scope: "private", name: "Adatelemző", description: "CSV-exportokat tisztít, összesít, és elmagyarázza, mit mutatnak a számok.", avatar: { kind: "gallery", id: "bars" }, role: "member", model: "gemini-2.5-pro", tools: "files", skills: ["csv-elemzes"], instructions: "Minden számhoz írd oda a forrás oszlopot.", projects: ["_ws", "billing"] },
  { key: "private:tesztiro", scope: "private", name: "Tesztíró", description: "Vitest egységteszteket írt a számlázó modulhoz.", avatar: { kind: "gallery", id: "leaf" }, role: "member", tools: "files", skills: [], instructions: "", projects: ["billing"], retired: true },
];
const INVOICE_LOG = [
  { user: "Nézd meg, miért lassú a /invoices lista 10 ezer sornál.", time: "tegnap 16:42" },
  { tool: "grep", ic: "search", arg: "\"findAll\" src/invoices" },
  { tool: "read", ic: "file", arg: "src/invoices/repository.ts" },
  { md: ["A lista minden sorhoz külön lekérdezést indít a partnerért (N+1).", "Javaslat: egy `JOIN` a partnerre, és lapozás 50 soronként. Írjak hozzá tesztet és javítást?"] },
  { div: true, when: { hu: "ma 09:15", en: "today 09:15" } },
  { user: "Igen, tesztet először.", time: "09:15" },
  { tool: "write", ic: "edit", arg: "src/invoices/repository.test.ts" },
  { tool: "edit", ic: "edit", arg: "src/invoices/repository.ts" },
];
// Conversations keyed "<personaKey>|<target>"; ago = minutes since last activity.
const CONVS = {
  "shared:backend|billing": [
    { id: "c1", title: "Lassú számlalista (N+1)", status: "busy", ago: 0, log: INVOICE_LOG },
    { id: "c2", title: "Lapozás API vázlat", status: "sleeping", ago: 3 * 1440, log: [
      { user: "Vázolj fel egy lapozós API-t, még kód nélkül.", time: "kedd 14:20" },
      { tool: "write", ic: "edit", arg: "docs/lapozas.md" },
      { md: ["Leírtam a `docs/lapozas.md` fájlba: kurzor alapú lapozás, 50-es alapméret, `next` token a válaszban."] }] },
    { id: "c3", title: "Régi migráció", status: "sleeping", ago: 30 * 1440, archived: true, log: [{ user: "Migráld a partner táblát.", time: "márc. 2." }] },
  ],
  "shared:backend|crm": [{ id: "c4", title: "Ügyfélkereső index", status: "sleeping", ago: 2 * 1440, log: [{ user: "Miért lassú az ügyfélkeresés?", time: "hétfő 10:02" }] }],
  "shared:projektvezeto|billing": [{ id: "c5", title: "Heti státusz", status: "running", ago: 10, log: [{ user: "Foglald össze a heti haladást.", time: "10:40" }, { md: ["Három nyitott feladat: N+1 javítás (folyamatban), lapozás (tervezés), CSV export (kész)."] }] }],
  "shared:kodbiralo|billing": [{ id: "c6", title: "PR #212 átnézése", status: "sleeping", ago: 1440, log: [{ user: "Nézd át a PR #212-t.", time: "tegnap 11:30" }] }],
  "shared:kodbiralo|crm": [{ id: "c7", title: "Régi CRM review", status: "sleeping", ago: 9 * 1440, log: [{ user: "Nézd át a keresőt.", time: "szept. 25." }] }],
  "private:szovegiro|_ws": [{ id: "c8", title: "Júniusi hírlevél", status: "running", ago: 5, stale: true, log: [
    { user: "Írj egy rövid hírlevél-bevezetőt a júniusi kiadásról.", time: "11:05" },
    { tool: "read", ic: "file", arg: "jegyzetek/junius.md" },
    { md: ["Szia! Júniusban gyorsabb lett a számlalista, és végre exportálhatsz CSV-be is.", "Nézd meg, mi változott, és írd meg, mit hiányolsz még."] }] }],
  "private:adatelemzo|_ws": [{ id: "c9", title: "Q2 export tisztítás", status: "sleeping", ago: 1440, log: [{ user: "Tisztítsd meg a q2.csv-t.", time: "tegnap 15:10" }] }],
  "private:tesztiro|billing": [{ id: "c10", title: "Számlázó tesztek", status: "sleeping", ago: 20 * 1440, log: [{ user: "Írj teszteket a számlázóhoz.", time: "szept. 14." }] }],
  "shared:rendszergazda|_ws": [{ id: "c11", title: "Naplók átnézése", status: "sleeping", ago: 4 * 1440, log: [{ user: "Nézd meg a nginx naplót.", time: "csüt. 09:00" }] }],
};

// ── State ──
// Storage can throw (sandboxed iframe, e.g. the dashboard canvas, or privacy mode): never let it kill the app.
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* in-memory only */ } },
};
const S = {
  lang: store.get("team:lang") || "hu",
  theme: store.get("team:theme") || "dark",
  host: store.get("team:host") || "standalone",
  role: "admin", mode: "multi", grid: "normal", convo: "ready", projects: "some", limit: false,
  personas: JSON.parse(JSON.stringify(PERSONAS)),
  convs: JSON.parse(JSON.stringify(CONVS)),
  folder: store.get("team:folder") || "/repo/billing-api",
  target: null, showArchived: false, ensured: new Set(), seq: 100,
  draft: null, draftKey: null, errors: {}, sending: false, focusAfter: null,
};
const MAX_CONVS = 50;
const allowedProjects = () => (S.projects === "none" ? [] : PROJECTS);
const projectOf = (id) => allowedProjects().find((x) => x.id === id);
const targetUsable = (tg) => tg === "_ws" || (!!projectOf(tg) && !projectOf(tg).unavailable);
const targetName = (tg) => (tg === "_ws" ? t("target.ws") : projectOf(tg)?.name ?? tg);
function currentTarget() { // folder placement: locked to the folder's project (D17); else remembered → first available project → own workspace (D10)
  if (S.host === "folder") { const m = matchFolder(S.folder); if (m) return m.id; }
  const saved = S.target || store.get("team:target");
  if (saved && targetUsable(saved)) return saved;
  return allowedProjects().find((x) => !x.unavailable)?.id ?? "_ws";
}
function setTarget(tg) { S.target = tg; store.set("team:target", tg); }
const user = () => (S.mode === "single"
  ? { name: "", initials: "OP", admin: true }
  : { name: "Kovács Anna", initials: "KA", admin: S.role === "admin" });
const isAdmin = () => user().admin;
const convsOf = (p, tg) => (S.convs[`${p.key}|${tg}`] ||= []);
const activeConvs = (p, tg) => convsOf(p, tg).filter((c) => !c.archived).sort((a, b) => a.ago - b.ago);
const assigned = (p, tg) => p.projects.includes(tg);
// GET /agents?project= (D8): assigned personas + unassigned/retired ones the user still has conversations with.
function agentsFor(tg) {
  return S.personas.filter((p) => (assigned(p, tg) && !p.retired) || activeConvs(p, tg).length > 0);
}
function agentState(p, tg) {
  if (p.retired) return { status: "retired", reason: "retired" };
  if (p.tools === "full" && S.mode === "multi") return { status: "unavailable", reason: "full" };
  if (!assigned(p, tg)) return { status: "unavailable", reason: "unassigned" };
  const act = activeConvs(p, tg);
  for (const st of ["busy", "running", "sleeping"]) if (act.some((c) => c.status === st)) return { status: st };
  return { status: "new" };
}
const canTalk = (p, tg) => !["retired", "unavailable"].includes(agentState(p, tg).status);
const atLimit = (p, tg) => S.limit || activeConvs(p, tg).length >= MAX_CONVS;
function convTitle(c) { return c.title || (c.log?.find((m) => m.user)?.user.slice(0, 60)) || t("cv.untitled"); }
function ago(min) {
  if (min < 1) return t("time.now");
  if (min < 60) return t("time.min", { n: min });
  if (min < 1440) return t("time.hour", { n: Math.round(min / 60) });
  return t("time.day", { n: Math.round(min / 1440) });
}

const t = (k, vars) => {
  let s = I18N[S.lang][k];
  if (s == null) { console.warn("missing i18n key", k); s = k; }
  return vars ? s.replace(/\{(\w+)\}/g, (_, v) => vars[v]) : s;
};

// ── DOM helpers (textContent only for data; innerHTML only for constant SVG) ──
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
function svg(inner, cls = "ic") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
  s.innerHTML = inner; return s;
}
const icon = (n, cls) => svg(ICON[n], cls);
function initialsOf(name) { return name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join("") || "?"; }
function avatar(p, size = "") {
  if (p.avatar.kind === "gallery" && GALLERY[p.avatar.id]) {
    const g = GALLERY[p.avatar.id];
    return h("span", { class: `avatar ${size} t-${g.tint}`, "aria-hidden": "true" }, svg(g.svg, ""));
  }
  return h("span", { class: `avatar ${size} t-neutral`, "aria-hidden": "true", text: initialsOf(p.name || "?") });
}
const announce = (msg) => { const a = document.getElementById("announce"); a.textContent = ""; setTimeout(() => (a.textContent = msg), 30); };
let toastTimer;
function toast(msg) { const el = document.getElementById("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3500); }
const codePoints = (s) => [...s].length;
const utf8Bytes = (s) => new TextEncoder().encode(s).length;

// ── Router ──
function route() {
  const raw = location.hash || "#/";
  const [path, query] = raw.slice(1).split("?");
  const params = new URLSearchParams(query || "");
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "signin") return { name: "signin" };
  if (seg[0] === "signin-unavailable") return { name: "signinUnavailable" };
  if (seg[0] === "not-admitted") return { name: "notAdmitted" };
  if (seg[0] === "agent") return { name: "agent", key: decodeURIComponent(seg[1] || ""), conv: seg[2] === "c" ? decodeURIComponent(seg[3] || "") : null };
  if (seg[0] === "personas") return { name: "editor", key: seg[1] === "new" ? null : decodeURIComponent(seg[1] || ""), fork: params.get("fork"), target: params.get("target") };
  return { name: "grid" };
}
const go = (hash) => { if (location.hash === hash) { render(); refocus(); } else location.hash = hash; }; // same-URL navigation still re-renders
const agentHref = (p, c) => `#/agent/${encodeURIComponent(p.key)}${c ? `/c/${c.id}` : ""}`;

// ── Shell ──
// Project selector (APG menu button, menuitemradio). Plain label when only the own workspace exists (Hick's Law).
function targetSelector() {
  const tg = currentTarget();
  if (S.host === "folder") return h("span", { class: "chip target-label", "data-testid": "target-selector" }, icon("folder", "ic sm"), h("span", { "aria-hidden": "true", text: targetName(tg) }), h("span", { class: "sr-only", text: t("fold.locked", { name: targetName(tg) }) }));
  const targets = [...allowedProjects().map((x) => x.id), "_ws"];
  if (targets.length === 1) return h("span", { class: "chip target-label", "data-testid": "target-selector" }, icon("home", "ic sm"), targetName(tg));
  const items = targets.map((id) => {
    const proj = projectOf(id);
    const meta = proj?.unavailable ? t("target.unavailable") : id === "_ws" ? t("target.mine") : t("target.shared");
    return { radio: true, checked: id === tg, target: id, disabled: !!proj?.unavailable,
      act: () => {
        setTarget(id); S.focusAfter = "target-selector";
        const r = route();
        const p = r.name === "agent" && S.personas.find((x) => x.key === r.key);
        if (r.name === "agent" && !(p && agentsFor(id).includes(p))) go("#/"); else { render(); refocus(); }
        announce(t("target.switched", { name: targetName(id) }));
      },
      node: [icon(id === "_ws" ? "home" : "folder", "ic sm"),
        h("span", { class: "mi-text" }, h("span", { class: "mi-name", text: targetName(id) }), h("span", { class: "mi-meta", text: meta })),
        h("span", { class: "mi-check", "aria-hidden": "true" }, id === tg ? icon("check", "ic sm") : null)] };
  });
  return menuButton(t("target.switch", { name: targetName(tg) }), items, "m-target", { testid: "target-selector", id: "target-selector", triggerClass: "btn btn-secondary target-trigger", menuClass: "menu-wide", menuLabel: t("target.menu"),
    trigger: [icon(tg === "_ws" ? "home" : "folder", "ic sm"), h("span", { class: "target-name", text: targetName(tg) }), icon("chevron", "ic sm")] });
}
function header(minimal) {
  const u = user();
  const lang = h("div", { class: "seg", role: "group", "aria-label": t("lang.group") },
    ...["hu", "en"].map((l) => h("button", { type: "button", lang: l, "aria-pressed": String(S.lang === l), "aria-label": l === "hu" ? "Magyar" : "English", text: l.toUpperCase(), onclick: () => setLang(l), "data-testid": `lang-${l}` })));
  const themeBtn = h("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.theme === "dark" ? t("theme.toLight") : t("theme.toDark"), onclick: toggleTheme, "data-testid": "theme-toggle" },
    icon(S.theme === "dark" ? "sun" : "moon"));
  let who = null;
  if (!minimal) {
    who = S.mode === "single"
      ? h("span", { class: "pill-local" }, t("user.local"))
      : h("span", { class: "user-chip" },
          h("span", { class: "initials", "aria-hidden": "true", text: u.initials }),
          h("span", { class: "user-name" }, u.name, u.admin ? ` · ${t("user.admin")}` : ""),
          h("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": t("user.signOut"), onclick: () => go("#/signin") }, icon("logout")));
  }
  return h("header", { class: "app-header" },
    h("a", { class: "brand", href: "#/", "aria-label": t("app.name") }, h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("people", "ic sm")), h("span", { class: "brand-text", text: t("app.name") })),
    minimal ? null : h("div", { class: "header-target" }, targetSelector()),
    h("div", { class: "header-end" }, lang, themeBtn, who));
}

// ── Grid ──
function statusEl(st) {
  return h("span", { class: "status", "data-status": st }, h("span", { class: `shape shape-${st}`, "aria-hidden": "true" }), t(`status.${st}`));
}
function personaMenuItems(p) {
  if (p.retired) return [];
  const items = [];
  const canWrite = p.scope === "private" || isAdmin();
  if (canWrite) items.push({ k: "menu.edit", ic: "edit", act: () => go(`#/personas/${encodeURIComponent(p.key)}`) });
  if (p.tools !== "full") items.push({ k: "menu.fork", ic: "fork", act: () => go(`#/personas/new?fork=${encodeURIComponent(p.key)}`) });
  if (canWrite) items.push({ k: "menu.delete", ic: "trash", danger: true, act: () => confirmDelete(p) });
  return items;
}
function menuButton(label, items, id, opts = {}) {
  if (!items.length) return null;
  const btn = h("button", { type: "button", class: opts.triggerClass || "btn btn-ghost btn-icon", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": id, "aria-label": label, "data-testid": opts.testid, id: opts.id },
    ...(opts.trigger || [icon("more")]));
  const list = h("ul", { class: `menu${opts.menuClass ? " " + opts.menuClass : ""}`, role: "menu", id, "aria-label": opts.menuLabel || label, hidden: true },
    ...items.map((it) => it === "sep" ? h("li", { role: "separator" })
      : h("li", { role: it.radio ? "menuitemradio" : "menuitem", tabindex: "-1", class: [it.danger ? "danger" : "", it.disabled ? "is-disabled" : ""].join(" ").trim(),
          "aria-checked": it.radio ? String(!!it.checked) : null, "aria-disabled": it.disabled ? "true" : null, "data-target": it.target,
          onclick: () => { if (it.disabled) return; close(true); it.act(); } },
        it.node || [icon(it.ic, "ic sm"), t(it.k)])));
  const menuItemsEls = () => [...list.querySelectorAll('[role^="menuitem"]')];
  function open(focusLast) { closeAllMenus(); list.hidden = false; btn.setAttribute("aria-expanded", "true"); const els = menuItemsEls(); (focusLast ? els.at(-1) : els.find((e) => e.getAttribute("aria-checked") === "true") || els[0]).focus(); }
  function close(refocus = true) { list.hidden = true; btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); }
  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); open(); } if (e.key === "ArrowUp") { e.preventDefault(); open(true); } });
  list.addEventListener("keydown", (e) => {
    const els = menuItemsEls(); const i = els.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); els.at(-1).focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement.click(); }
  });
  list._close = close;
  return h("div", { class: "menu-wrap" }, btn, list);
}
function closeAllMenus() { document.querySelectorAll(".menu:not([hidden])").forEach((m) => m._close?.(false)); }
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeAllMenus(); });

function openAgent(p) { // latest active conversation, or create the first one
  const tg = currentTarget(); const latest = activeConvs(p, tg)[0];
  if (latest) go(agentHref(p, latest)); else newConversation(p);
}
function newConversation(p) {
  const tg = currentTarget();
  if (atLimit(p, tg)) { toast(t("cv.limit", { max: MAX_CONVS })); return; }
  const c = { id: `c${++S.seq}`, title: null, status: "new", ago: 0, log: [] };
  convsOf(p, tg).push(c);
  go(agentHref(p, c));
}
function agentCard(p) {
  const tg = currentTarget();
  const { status: st, reason } = agentState(p, tg);
  const dim = st === "retired" || st === "unavailable";
  const act = activeConvs(p, tg);
  const stale = act.some((c) => c.stale && (c.status === "running" || c.status === "busy"));
  const chips = h("div", { class: "chips" },
    statusEl(st),
    h("span", { class: "chip model", title: p.model || t("model.default") }, p.model || t("model.default")),
    h("span", { class: "chip" }, icon(p.scope === "shared" ? "people" : "person", "ic sm"), t(p.scope === "shared" ? "scope.shared" : "scope.private")),
    p.tools === "full" ? h("span", { class: "chip pill-unconfined" }, icon("warning", "ic sm"), t("tools.unconfined")) : null);
  const activity = h("p", { class: "activity-line", "data-testid": "activity" }, icon("chat", "ic sm"),
    act.length ? `${t(act.length === 1 ? "card.convOne" : "card.convMany", { n: act.length })} · ${ago(act[0].ago)}` : t("card.noConv"));
  let actions;
  if (dim) {
    actions = h("div", { class: "card-note-wrap" }, h("p", { class: "card-note", text: t(`card.${reason}Note`) }),
      act.length ? h("a", { class: "btn btn-secondary", href: agentHref(p), "data-testid": "open-list" }, t("card.openList", { n: act.length })) : null);
  } else {
    actions = [
      h("button", { type: "button", class: "btn btn-primary", "aria-label": t("card.talkTo", { name: p.name }), onclick: () => openAgent(p), "data-testid": "talk" }, icon("chat", "ic sm"), t("card.talk")),
      h("button", { type: "button", class: "btn btn-secondary", "aria-label": t("card.newTo", { name: p.name }), title: atLimit(p, tg) ? t("cv.limit", { max: MAX_CONVS }) : null, disabled: atLimit(p, tg), onclick: () => newConversation(p), "data-testid": "new-conv" }, icon("plus", "ic sm"), t("card.new")),
    ];
  }
  const staleBox = stale && !dim ? h("div", { class: "callout callout-info stack" }, icon("info", "ic sm"),
    h("div", { class: "grow" }, h("p", { text: t("card.stale") })),
    h("button", { type: "button", class: "btn btn-secondary", onclick: () => restartStale(p, tg) }, icon("refresh", "ic sm"), t("card.restart"))) : null;
  return h("article", { class: `card agent-card${dim ? " is-dim" : ""}`, "aria-labelledby": `n-${p.key}`, "data-key": p.key, "data-status": st },
    h("div", { class: "agent-top" }, avatar(p),
      h("div", { class: "agent-info" },
        h("div", { class: "agent-name-row" },
          h("h3", { class: "agent-name", id: `n-${p.key}`, title: p.name, text: p.name }),
          p.role === "leader" ? h("span", { class: "chip pill-leader" }, t("role.leader")) : null),
        h("p", { class: "agent-desc", text: p.description }))),
    chips, activity, staleBox,
    h("div", { class: "card-actions" }, actions, menuButton(t("card.more", { name: p.name }), personaMenuItems(p), `m-${p.key}`)));
}
function gridView() {
  const tg = currentTarget();
  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", { class: "page-title", text: t("grid.title") }), h("p", { class: "subtitle", text: t("grid.subtitleTarget", { name: targetName(tg) }) })),
    h("button", { type: "button", class: "btn btn-primary", onclick: () => go(`#/personas/new?target=${tg}`), "data-testid": "new-persona" }, icon("plus", "ic sm"), t("grid.new")));
  const page = h("div", { class: "page" }, head);
  if (S.grid === "loading") {
    page.append(h("p", { class: "live", role: "status", text: t("grid.loading") }),
      h("div", { class: "grid", "aria-hidden": "true" }, ...Array.from({ length: 6 }, () => h("div", { class: "card skeleton" },
        h("div", { style: "display:flex;gap:0.75rem" }, h("div", { class: "sk", style: "width:2.75rem;height:2.75rem;border-radius:999px" }), h("div", { style: "flex:1;display:flex;flex-direction:column;gap:0.5rem" }, h("div", { class: "sk", style: "height:0.875rem;width:60%" }), h("div", { class: "sk", style: "height:0.75rem" }))),
        h("div", { class: "sk", style: "height:0.75rem;width:70%" }), h("div", { class: "sk", style: "height:2.25rem;margin-top:auto" })))));
    return page;
  }
  if (S.grid === "error") {
    page.append(h("div", { class: "callout callout-error", role: "alert" }, icon("alert", "ic sm"),
      h("div", { class: "grow" }, h("p", {}, h("strong", { text: t("grid.error") })), h("p", { text: t("grid.errorDetail") })),
      h("button", { type: "button", class: "btn btn-secondary", onclick: () => { S.grid = "normal"; document.getElementById("mGrid").value = "normal"; render(); } }, icon("refresh", "ic sm"), t("grid.retry"))));
    return page;
  }
  const agents = S.grid === "empty" ? [] : agentsFor(tg);
  if (!agents.length) {
    page.append(h("div", { class: "card empty", "data-testid": "empty-target" },
      h("p", { text: t(tg === "_ws" ? "grid.emptyWs" : "grid.emptyTarget", { name: targetName(tg) }) }),
      isAdmin() ? h("p", { class: "hint", text: t("grid.emptyAdmin") }) : null,
      h("div", { class: "row-actions" },
        canManage() && tg !== "_ws" ? h("button", { type: "button", class: "btn btn-primary", onclick: () => addAgentsDialog(tg), "data-testid": "add-agents" }, icon("people", "ic sm"), t("grid.addAgents")) : null,
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => go(`#/personas/new?target=${tg}`) }, icon("plus", "ic sm"), t("grid.emptyCta")))));
    return page;
  }
  const section = (titleKey, list, id) => list.length ? h("section", { class: "section", "aria-labelledby": id },
    h("div", { class: "section-head" }, h("h2", { class: "section-title", id, text: t(titleKey) }), h("span", { class: "count", text: t("grid.count", { n: list.length }) })),
    h("div", { class: "grid" }, ...list.map(agentCard))) : null;
  page.append(...[section("grid.shared", agents.filter((p) => p.scope === "shared"), "sec-shared"),
    section("grid.own", agents.filter((p) => p.scope === "private"), "sec-own")].filter(Boolean));
  return page;
}

// ── Actions ──
function restartStale(p, tg) {
  for (const c of convsOf(p, tg)) if (c.stale) { c.stale = false; if (c.status === "running" || c.status === "busy") c.status = "sleeping"; }
  toast(t("toast.restarted")); render();
}
const dlg = () => document.getElementById("confirmDialog");
function confirmDialog(title, body, okLabel, onOk, opts = {}) {
  const d = dlg(); const opener = document.activeElement;
  d.querySelector("#dlgTitle").textContent = title;
  const b = d.querySelector("#dlgBody");
  const input = opts.input ? h("input", { class: "input", id: "dlgInput", value: opts.input.value, maxlength: "200", "aria-describedby": "dlgHint" }) : null;
  b.replaceChildren(...[body ? h("p", { text: body }) : null,
    input ? h("div", { class: "field" }, h("label", { for: "dlgInput", text: opts.input.label }), input, h("p", { class: "hint", id: "dlgHint", text: opts.input.hint })) : null].filter(Boolean));
  d.querySelector("#dlgCancel").textContent = t("dlg.cancel");
  const ok = d.querySelector("#dlgOk"); ok.textContent = okLabel;
  ok.className = `btn ${opts.primary ? "btn-primary" : "btn-danger"}`;
  ok.onclick = () => { d.close(); onOk(input?.value); };
  d.querySelector("#dlgCancel").onclick = () => d.close();
  d.onclose = () => { if (opener && document.contains(opener)) opener.focus(); };
  d.showModal(); (input || d.querySelector("#dlgCancel")).focus();
}
function confirmDelete(p) {
  confirmDialog(t("dlg.delete.title", { name: p.name }), t("dlg.delete.body"), t("dlg.delete.ok"), () => {
    const hasConvs = Object.keys(S.convs).some((k) => k.startsWith(`${p.key}|`) && S.convs[k].length);
    if (!hasConvs) S.personas = S.personas.filter((x) => x !== p); else p.retired = true;
    toast(t("toast.deleted")); go("#/"); render();
  });
}

// ── Agent view: conversation list + conversation (D10) ──
let convoTimer;
function convMenu(p, tg, c, readOnly) {
  const items = [];
  if (c.stale && !readOnly && !c.archived) items.push({ k: "menu.restart", ic: "refresh", act: () => { c.stale = false; c.status = "sleeping"; toast(t("toast.restarted")); render(); } });
  items.push({ k: "menu.rename", ic: "edit", act: () => confirmDialog(t("dlg.rename.title"), null, t("dlg.rename.ok"), (v) => {
    const title = (v || "").trim();
    if (!title || codePoints(title) > 80) { toast(t("err.title_invalid")); return; }
    c.title = title; toast(t("toast.renamed")); render();
  }, { primary: true, input: { label: t("dlg.rename.label"), value: convTitle(c), hint: t("dlg.rename.hint") } }) });
  if (S.host === "embedded") items.push({ k: "menu.openDash", ic: "openExt", act: () => toast(t("toast.openDash")) }); // host.capabilities.dashboard
  if (c.archived) items.push({ k: "menu.restore", ic: "reset", act: () => restoreConv(p, tg, c) });
  else items.push({ k: "menu.archive", ic: "archive", act: () => { c.archived = true; c.status = "sleeping"; toast(t("toast.archived")); go(agentHref(p)); } });
  items.push("sep", { k: "menu.deleteConv", ic: "trash", danger: true, act: () => confirmDialog(t("dlg.deleteConv.title", { title: convTitle(c) }), t("dlg.deleteConv.body"), t("dlg.deleteConv.ok"), () => {
    S.convs[`${p.key}|${tg}`] = convsOf(p, tg).filter((x) => x !== c); toast(t("toast.deletedConv")); go(agentHref(p));
  }) });
  return menuButton(t("cv.convMenu", { title: convTitle(c) }), items, "m-conv", { testid: "conv-menu" });
}
function restoreConv(p, tg, c) {
  if (atLimit(p, tg)) { toast(t("cv.limit", { max: MAX_CONVS })); return; }
  c.archived = false; S.showArchived = false; toast(t("toast.restoredConv")); go(agentHref(p, c)); // back to the active list, where it now lives
}
function listPane(p, tg, sel) {
  const { status: st, reason } = agentState(p, tg);
  const readOnly = st === "retired" || st === "unavailable";
  const all = convsOf(p, tg).slice().sort((a, b) => a.ago - b.ago);
  const shown = all.filter((c) => !!c.archived === S.showArchived);
  const archivedN = all.filter((c) => c.archived).length;
  const limit = atLimit(p, tg);
  const toolsKey = { chat: "cv.toolsChat", files: "cv.toolsFiles", full: "cv.toolsFull" }[p.tools];
  return h("nav", { class: "conv-list-pane", "aria-label": t("cv.list") },
    h("a", { class: "back-link", href: "#/" }, icon("back", "ic sm"), t("cv.back")),
    h("div", { class: "convo-id" }, avatar(p, "sm"),
      h("div", { class: "agent-info" },
        h("div", { class: "agent-name-row" }, h("h1", { class: "agent-name", text: p.name }), p.role === "leader" ? h("span", { class: "chip pill-leader" }, t("role.leader")) : null),
        h("div", { class: "convo-meta" }, statusEl(st), h("span", { class: "chip", title: t("cv.workspace") }, icon(p.tools === "full" ? "warning" : "shield", "ic sm"), t(toolsKey))))),
    readOnly ? h("p", { class: "hint", text: t(`card.${reason}Note`) })
      : h("div", { class: "new-conv" },
          h("button", { type: "button", class: "btn btn-primary", disabled: limit, "aria-describedby": limit ? "limit-hint" : null, onclick: () => newConversation(p), "data-testid": "list-new-conv" }, icon("plus", "ic sm"), t("cv.new")),
          limit ? h("p", { class: "hint", id: "limit-hint", text: t("cv.limit", { max: MAX_CONVS }) }) : null),
    h("h2", { class: "section-title", id: "conv-list-h", text: S.showArchived ? t("cv.archivedTitle") : t("cv.list") }),
    shown.length
      ? h("ul", { class: "conv-list", "aria-labelledby": "conv-list-h", "data-testid": "conv-list" },
          ...shown.map((c) => h("li", {}, h("a", { class: "conv-item", href: agentHref(p, c), "aria-current": sel && sel.id === c.id ? "page" : null, "data-conv": c.id },
            h("span", { class: `shape shape-${c.status === "new" ? "new" : c.status}`, "aria-hidden": "true" }),
            h("span", { class: "conv-text" }, h("span", { class: "conv-title", text: convTitle(c) }),
              h("span", { class: "conv-meta" }, `${t(`status.${c.status}`)} · ${ago(c.ago)}`, c.stale ? ` · ${t("cv.staleShort")}` : ""))))))
      : h("p", { class: "hint", text: t(S.showArchived ? "cv.emptyArchived" : "cv.emptyList") }),
    archivedN || S.showArchived ? h("button", { type: "button", class: "btn btn-ghost", "aria-pressed": String(S.showArchived), onclick: () => { S.showArchived = !S.showArchived; render(); }, "data-testid": "toggle-archived" },
      icon("archive", "ic sm"), S.showArchived ? t("cv.showActive") : t("cv.showArchived", { n: archivedN })) : null);
}
function chatPane(p, tg, c) {
  const { status: agentSt, reason } = agentState(p, tg);
  const readOnly = agentSt === "retired" || agentSt === "unavailable";
  if (!c) return h("section", { class: "chat-pane", "aria-label": t("cv.list") }, h("p", { class: "hint chat-empty", text: t("cv.pick") }));
  const ek = `${p.key}|${tg}|${c.id}`;
  const auto = !readOnly && !c.archived && S.convo === "ready" && !S.ensured.has(ek) ? (c.status === "new" ? "spawn" : c.status === "sleeping" ? "resume" : null) : null;
  if (!auto) S.ensured.add(ek);
  const sim = readOnly || c.archived ? "ready" : (auto || S.convo);
  const ensuring = sim === "spawn" || sim === "resume";
  const failed = sim === "spawn_timeout" || sim === "guard_unavailable";
  const busy = !ensuring && !failed && (c.status === "busy" || S.sending);
  const blocked = ensuring || failed || readOnly || c.archived;

  const head = h("div", { class: "chat-head" },
    h("a", { class: "back-link list-back", href: agentHref(p) }, icon("back", "ic sm"), t("cv.backList")),
    h("div", { class: "chat-title" }, h("h2", { class: "conv-heading", text: convTitle(c) }),
      h("span", { class: "convo-meta" }, statusEl(ensuring ? "sleeping" : busy ? "busy" : c.status === "new" ? "running" : c.status), h("span", { class: "chip model hide-sm" }, p.model || t("model.default")))),
    convMenu(p, tg, c, readOnly));

  const banners = h("div", { class: "convo-banners" });
  if (readOnly) banners.append(h("div", { class: "callout callout-warning", role: "status" }, icon("warning", "ic sm"), h("div", { class: "grow" }, h("p", { text: t(`cv.readOnly.${reason}`) }))));
  if (c.archived) banners.append(h("div", { class: "callout callout-info" }, icon("archive", "ic sm"), h("div", { class: "grow" }, h("p", { text: t("cv.archivedBanner") })),
    readOnly ? null : h("button", { type: "button", class: "btn btn-secondary", onclick: () => restoreConv(p, tg, c) }, icon("reset", "ic sm"), t("menu.restore"))));
  if (c.stale && !c.archived && !readOnly) banners.append(h("div", { class: "callout callout-info" }, icon("info", "ic sm"), h("div", { class: "grow" }, h("p", { text: t("cv.stale") })),
    h("button", { type: "button", class: "btn btn-secondary", onclick: () => { c.stale = false; c.status = "sleeping"; S.ensured.delete(ek); toast(t("toast.restarted")); render(); } }, icon("refresh", "ic sm"), t("cv.restart"))));
  if (sim === "reconnect") banners.append(h("div", { class: "callout callout-warning", role: "status" }, icon("warning", "ic sm"),
    h("div", { class: "grow" }, h("p", {}, h("strong", { text: t("cv.reconnect") })), h("p", { text: t("cv.reconnectDetail") }))));
  if (failed) banners.append(h("div", { class: "callout callout-error", role: "alert" }, icon("alert", "ic sm"),
    h("div", { class: "grow" }, h("p", {}, h("strong", { text: t(`cv.${sim}`) })), h("p", { text: t(`cv.${sim}Detail`) })),
    h("button", { type: "button", class: "btn btn-secondary", onclick: () => { S.convo = "spawn"; syncMock(); render(); } }, icon("refresh", "ic sm"), t("cv.retry"))));

  const tr = h("div", { class: "transcript", role: "log", "aria-label": convTitle(c), "data-testid": "transcript", tabindex: "0" });
  if (ensuring) tr.append(h("p", { class: "thinking", role: "status", style: "margin-top:2rem" }, h("span", { class: "shape shape-busy", "aria-hidden": "true" }), t(sim === "spawn" ? "cv.spawn" : "cv.resume")));
  else if (!failed) {
    if (!c.log.length) tr.append(h("p", { class: "hint chat-empty", text: t("cv.startHint", { name: p.name }) }));
    for (const m of c.log) {
      if (m.div) tr.append(h("div", { class: "history-divider" }, `${t("cv.history")} · ${m.when[S.lang]}`));
      else if (m.user) tr.append(h("div", { class: "msg-user" }, h("div", { class: "bubble", text: m.user }), h("span", { class: "msg-time", text: m.time })));
      else if (m.tool) tr.append(h("div", { class: "tool-step" }, icon(m.ic, "ic sm"), h("span", { class: "tool-name", text: m.tool }), h("span", { class: "tool-arg", text: m.arg }), h("span", { class: "ok" }, icon("check", "ic sm"), h("span", { class: "sr-only", text: "ok" }))));
      else if (m.md) tr.append(h("div", { class: "msg-assistant" }, ...m.md.map((line) => h("p", {}, ...line.split(/(`[^`]+`)/).map((part) => part.startsWith("`") ? h("code", { text: part.slice(1, -1) }) : part)))));
    }
    if (busy) tr.append(h("p", { class: "thinking", role: "status" }, h("span", { class: "shape shape-busy", "aria-hidden": "true" }), t("cv.thinking")));
  }

  const ta = h("textarea", { id: "prompt", rows: "1", "aria-label": t("cv.inputLabel"), placeholder: t("cv.placeholder", { name: p.name }), disabled: blocked,
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(p, c, ta); } } });
  const sendBtn = busy
    ? h("button", { type: "button", class: "btn btn-danger btn-send", "aria-label": t("cv.stop"), onclick: () => { S.sending = false; c.status = "running"; clearTimeout(convoTimer); render(); } }, icon("stop"))
    : h("button", { type: "button", class: "btn btn-primary btn-send", "aria-label": t("cv.send"), disabled: blocked, onclick: () => send(p, c, ta), "data-testid": "send" }, icon("send"));
  const composer = h("div", { class: "composer" }, h("div", { class: "composer-card" }, ta, sendBtn),
    h("p", { class: "composer-hint" }, icon("shield", "ic sm"), `${t("cv.workspaceIn", { name: targetName(tg) })} · ${t("cv.hint")}`));

  if (ensuring) { clearTimeout(convoTimer); convoTimer = setTimeout(() => { S.convo = "ready"; S.ensured.add(ek); c.status = "running"; syncMock(); if (route().name === "agent") { render(); refocus(); } announce(convTitle(c)); }, 1600); }
  if (sim === "reconnect") { clearTimeout(convoTimer); convoTimer = setTimeout(() => { S.convo = "ready"; syncMock(); render(); toast(t("toast.reconnected")); }, 2500); }
  queueMicrotask(() => { tr.scrollTop = tr.scrollHeight; });
  return h("section", { class: "chat-pane", "aria-label": convTitle(c) }, head, banners, tr, composer);
}
function agentView(r) {
  const p = S.personas.find((x) => x.key === r.key);
  const tg = currentTarget();
  if (!p || !agentsFor(tg).includes(p)) return notFound();
  const all = convsOf(p, tg);
  let sel = r.conv ? all.find((c) => c.id === r.conv) : null;
  if (r.conv && !sel) return notFound("cv.convNotFound");
  const wideDefault = !r.conv ? activeConvs(p, tg)[0] || null : null; // wide screens open the newest
  if (sel?.archived) S.showArchived = true;
  return h("div", { class: "agent-view", "data-route": r.conv ? "conv" : "list" }, listPane(p, tg, sel || wideDefault), chatPane(p, tg, sel || wideDefault));
}
function send(p, c, ta) {
  const text = ta.value.trim(); if (!text || S.sending) return;
  const now = new Date(); const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  c.log.push({ user: text, time }); c.ago = 0;
  S.sending = true; c.status = "busy"; render(); document.getElementById("prompt")?.focus();
  convoTimer = setTimeout(() => {
    c.log.push({ md: [S.lang === "hu" ? "Rendben, ezt nézem meg most. (Mockup válasz.)" : "On it. (Mockup reply.)"] });
    if (!c.title) c.title = text.slice(0, 60); // stands in for the dashboard auto-namer
    S.sending = false; c.status = "running"; render(); document.getElementById("prompt")?.focus();
  }, 1500);
}
function notFound(key = "cv.notFound") {
  return h("div", { class: "page" }, h("a", { class: "back-link", href: "#/" }, icon("back", "ic sm"), t("ed.back")),
    h("div", { class: "callout callout-warning", role: "alert" }, icon("warning", "ic sm"), h("div", { class: "grow" }, h("p", { text: t(key) }))));
}

// ── Persona editor ──
function draftFrom(r) {
  if (S.draft && S.draftKey === location.hash) return S.draft;
  let d;
  const src = r.fork ? S.personas.find((p) => p.key === r.fork) : r.key ? S.personas.find((p) => p.key === r.key) : null;
  if (src) d = { ...JSON.parse(JSON.stringify(src)) };
  else d = { scope: "private", name: "", description: "", avatar: { kind: "gallery", id: "hex" }, role: "member", model: "", tools: "chat", skills: [], instructions: "",
    projects: ["_ws", ...(r.target && r.target !== "_ws" && targetUsable(r.target) ? [r.target] : [])] }; // own workspace + the project it was opened from
  if (r.fork) { // fork keeps only targets the forker may use, else own workspace (D3)
    d.forkedFrom = r.fork; d.scope = "private"; d.key = null; delete d.retired; if (d.tools === "full") d.tools = "files";
    d.projects = d.projects.filter((x) => x === "_ws" || targetUsable(x)); if (!d.projects.length) d.projects = ["_ws"];
  }
  if (!isAdmin()) d.scope = "private";
  S.draft = d; S.draftKey = location.hash; S.errors = {};
  return d;
}
function readForm(form, d) {
  const fd = new FormData(form);
  d.name = fd.get("name") ?? d.name; d.description = fd.get("description") ?? d.description; d.instructions = fd.get("instructions") ?? d.instructions;
  d.model = fd.get("model") ?? d.model; d.role = fd.get("role") || d.role; d.tools = fd.get("tools") || d.tools;
  if (fd.get("scope")) d.scope = fd.get("scope");
  const av = fd.get("avatar"); if (av) d.avatar = av === "initials" ? { kind: "initials" } : { kind: "gallery", id: av };
  d.skills = fd.getAll("skills");
  if (form.querySelector("[name=projects]")) d.projects = fd.getAll("projects");
}
// Assignable targets (D3): admin on a shared persona = every configured project; otherwise own workspace + allowed projects.
function assignable(d) {
  const projs = d.scope === "shared" && isAdmin() ? PROJECTS : allowedProjects();
  return ["_ws", ...projs.filter((x) => !x.unavailable).map((x) => x.id)];
}
function fullAllowed(d) { return d.scope === "shared" && S.mode === "single"; }
function editorView(r) {
  const d = draftFrom(r);
  const editing = !!(r.key && !r.fork);
  if (editing && !d.key) return notFound();
  const src = r.fork ? S.personas.find((p) => p.key === r.fork) : null;
  const errs = S.errors;
  const fieldErr = (name) => errs[name] ? h("p", { class: "field-error", id: `${name}-err` }, icon("alert", "ic sm"), t(`err.${errs[name]}`)) : null;
  const describedBy = (name, hint) => [hint, errs[name] ? `${name}-err` : null].filter(Boolean).join(" ");
  const counter = (id, n, max, bytes) => h("span", { class: "hint", id, "aria-live": "polite", text: t(bytes ? "ed.bytes" : "ed.counter", { n: n.toLocaleString(S.lang), max: max.toLocaleString(S.lang) }) });

  const form = h("form", { class: "form", novalidate: true, "data-testid": "persona-form" });
  const summary = Object.keys(errs).length ? h("div", { class: "error-summary", role: "alert", tabindex: "-1", id: "err-summary" },
    h("h2", { text: t("ed.errSummary") }),
    h("ul", {}, ...Object.entries(errs).map(([f, code]) => h("li", {}, h("a", { href: `#f-${f}`, onclick: (e) => { e.preventDefault(); document.getElementById(`f-${f}`).focus(); }, text: t(`err.${code}`) }))))) : null;

  const scopeField = editing || !isAdmin()
    ? h("div", { class: "field" }, h("span", { class: "hint" }, `${t("ed.scope")}: `, h("strong", { text: d.scope === "shared" ? t("ed.scopeShared") : t("ed.scopeFixed") })))
    : h("fieldset", { class: "field" }, h("legend", { text: t("ed.scope") }),
        h("div", { class: "radio-cards cols-2" },
          ...[["shared", "ed.scopeShared", "ed.scopeSharedDesc"], ["private", "ed.scopePrivate", "ed.scopePrivateDesc"]].map(([v, a, b]) =>
            h("label", { class: "radio-card" }, h("input", { type: "radio", name: "scope", value: v, checked: d.scope === v, onchange: () => { readForm(form, d); if (!fullAllowed(d) && d.tools === "full") d.tools = "files"; render(); } }),
              h("span", {}, h("span", { class: "rc-title", text: t(a) }), h("span", { class: "rc-desc", text: t(b) }))))));

  const toolOpts = [["chat", "ed.toolsChat", "ed.toolsChatDesc"], ["files", "ed.toolsFiles", "ed.toolsFilesDesc"]];
  if (fullAllowed(d)) toolOpts.push(["full", "ed.toolsFull", "ed.toolsFullDesc"]);
  const fullHint = fullAllowed(d) ? null : h("p", { class: "hint", text: t(d.scope === "shared" ? "ed.toolsFullAbsentMulti" : "ed.toolsFullAbsentPrivate") });

  form.append(...[
    summary,
    src ? h("div", { class: "callout callout-info" }, icon("fork", "ic sm"), h("div", { class: "grow" }, h("p", { text: t("ed.forkFrom", { name: src.name }) }))) : null,
    scopeField,
    h("div", { class: `field${errs.name ? " has-error" : ""}` },
      h("label", { for: "f-name", text: t("ed.name") }),
      h("div", { class: "hint-row" }, h("span", { class: "hint", id: "name-hint", text: t("ed.nameHint") }), counter("name-count", codePoints(d.name), 60)),
      fieldErr("name"),
      h("input", { class: "input", id: "f-name", name: "name", value: d.name, autocomplete: "off", "aria-describedby": describedBy("name", "name-hint name-count"), "aria-invalid": errs.name ? "true" : null,
        oninput: (e) => { form.querySelector("#name-count").textContent = t("ed.counter", { n: codePoints(e.target.value), max: 60 }); } })),
    h("div", { class: `field${errs.description ? " has-error" : ""}` },
      h("label", { for: "f-description", text: t("ed.desc") }),
      h("div", { class: "hint-row" }, h("span", { class: "hint", id: "desc-hint", text: t("ed.descHint") }), counter("desc-count", codePoints(d.description), 280)),
      fieldErr("description"),
      h("textarea", { class: "textarea", id: "f-description", name: "description", rows: "2", "aria-describedby": describedBy("description", "desc-hint desc-count"), "aria-invalid": errs.description ? "true" : null,
        oninput: (e) => { form.querySelector("#desc-count").textContent = t("ed.counter", { n: codePoints(e.target.value), max: 280 }); } }, d.description)),
    h("fieldset", { class: `field${errs.projects ? " has-error" : ""}`, "aria-describedby": describedBy("projects", "projects-hint"), "data-testid": "projects-field" },
      h("legend", { text: t("ed.projects") }), h("p", { class: "hint", id: "projects-hint", text: t("ed.projectsHint") }), fieldErr("projects"),
      h("div", { class: "check-list" }, ...assignable(d).map((id, i) => h("label", {},
        h("input", { type: "checkbox", name: "projects", value: id, id: i === 0 ? "f-projects" : null, checked: d.projects.includes(id) }),
        icon(id === "_ws" ? "home" : "folder", "ic sm"), h("span", { text: id === "_ws" ? t("target.ws") : (PROJECTS.find((x) => x.id === id)?.name ?? id) }))))),
    h("fieldset", { class: "field" }, h("legend", { text: t("ed.avatar") }),
      h("div", { class: "avatar-grid" },
        ...Object.keys(GALLERY).map((id) => h("label", { class: "avatar-opt" },
          h("input", { type: "radio", name: "avatar", value: id, checked: d.avatar.kind === "gallery" && d.avatar.id === id, "aria-label": t(`av.${id}`) }),
          avatar({ avatar: { kind: "gallery", id }, name: "" }))),
        h("label", { class: "avatar-opt" }, h("input", { type: "radio", name: "avatar", value: "initials", checked: d.avatar.kind === "initials", "aria-label": t("ed.avatarInitials") }),
          avatar({ avatar: { kind: "initials" }, name: d.name || "A B" })))),
    h("fieldset", { class: "field" }, h("legend", { text: t("ed.role") }),
      h("div", { class: "radio-cards cols-2" },
        ...[["member", "ed.roleMember", "ed.roleMemberDesc"], ["leader", "ed.roleLeader", "ed.roleLeaderDesc"]].map(([v, a, b]) =>
          h("label", { class: "radio-card" }, h("input", { type: "radio", name: "role", value: v, checked: d.role === v }),
            h("span", {}, h("span", { class: "rc-title", text: t(a) }), h("span", { class: "rc-desc", text: t(b) })))))),
    h("div", { class: "field" }, h("label", { for: "f-model", text: t("ed.model") }),
      h("select", { class: "select", id: "f-model", name: "model" },
        h("option", { value: "", selected: !d.model, text: t("ed.modelDefault") }),
        ...MODELS.map((m) => h("option", { value: m, selected: d.model === m, text: m })))),
    h("fieldset", { class: "field" }, h("legend", { text: t("ed.tools") }),
      h("div", { class: `radio-cards ${toolOpts.length === 3 ? "cols-3" : "cols-2"}` },
        ...toolOpts.map(([v, a, b]) => h("label", { class: "radio-card", "data-tool": v }, h("input", { type: "radio", name: "tools", value: v, checked: d.tools === v }),
          h("span", {}, h("span", { class: "rc-title" }, t(a), v === "full" ? h("span", { class: "chip pill-unconfined", style: "margin-left:0.375rem" }, icon("warning", "ic sm"), t("tools.unconfined")) : null), h("span", { class: "rc-desc", text: t(b) }))))),
      fullHint),
    h("fieldset", { class: "field" }, h("legend", { text: t("ed.skills") }), h("p", { class: "hint", text: t("ed.skillsHint") }),
      h("div", { class: "check-list" }, ...SKILLS.map((s) => h("label", {}, h("input", { type: "checkbox", name: "skills", value: s.id, checked: d.skills.includes(s.id) }),
        h("span", { class: "mono", text: s.id }), h("span", { class: "hint", text: `· ${s.desc[S.lang]}` }))))),
    h("div", { class: `field${errs.instructions ? " has-error" : ""}` },
      h("label", { for: "f-instructions", text: t("ed.instr") }),
      h("div", { class: "hint-row" }, h("span", { class: "hint", id: "instr-hint", text: t("ed.instrHint") }), counter("instr-count", utf8Bytes(d.instructions), 32768, true)),
      fieldErr("instructions"),
      h("textarea", { class: "textarea tall", id: "f-instructions", name: "instructions", "aria-describedby": describedBy("instructions", "instr-hint instr-count"),
        oninput: (e) => { form.querySelector("#instr-count").textContent = t("ed.bytes", { n: utf8Bytes(e.target.value).toLocaleString(S.lang), max: (32768).toLocaleString(S.lang) }); } }, d.instructions)),
    h("div", { class: "callout callout-info" }, icon("info", "ic sm"), h("div", { class: "grow" }, h("p", { text: t("ed.applyNote") }))),
    h("div", { class: "form-actions" },
      h("button", { type: "submit", class: "btn btn-primary", id: "saveBtn", "data-testid": "save" }, t("ed.save")),
      h("a", { class: "btn btn-secondary", href: "#/", style: "text-decoration:none", onclick: () => { S.draft = null; } }, t("ed.cancel")),
      h("span", { class: "spacer" }),
      editing ? h("button", { type: "button", class: "btn btn-danger", onclick: () => confirmDelete(S.personas.find((p) => p.key === d.key)) }, icon("trash", "ic sm"), t("ed.delete")) : null),
  ].filter(Boolean));

  form.addEventListener("submit", (e) => {
    e.preventDefault(); readForm(form, d);
    const btn = form.querySelector("#saveBtn"); btn.disabled = true; btn.textContent = t("ed.saving");
    setTimeout(() => save(d, editing), 400); // simulated round-trip; server is the validator (D3)
  });
  form._draft = d;
  return h("div", { class: "page form-page" },
    h("a", { class: "back-link", href: "#/", onclick: () => { S.draft = null; } }, icon("back", "ic sm"), t("ed.back")),
    h("h1", { class: "page-title", text: editing ? t("ed.edit") : t("ed.new") }), form);
}
function save(d, editing) {
  // Mirrors server 400 field errors (D3): code points, UTF-8 bytes.
  const errs = {};
  if (!d.name.trim()) errs.name = "name_required";
  else if (codePoints(d.name) > 60) errs.name = "name_too_long";
  if (codePoints(d.description) > 280) errs.description = "description_too_long";
  if (utf8Bytes(d.instructions) > 32768) errs.instructions = "instructions_too_large";
  if (!d.projects.length) errs.projects = "projects_required";
  S.errors = errs;
  if (Object.keys(errs).length) { render(); document.getElementById("err-summary")?.focus(); return; }
  let stale = false;
  if (editing) {
    const p = S.personas.find((x) => x.key === d.key); Object.assign(p, d);
    for (const [k, list] of Object.entries(S.convs)) if (k.startsWith(`${p.key}|`)) for (const c of list) if (c.status === "running" || c.status === "busy") { c.stale = true; stale = true; }
  } else {
    const slug = d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "persona";
    S.personas.push({ ...d, key: `${d.scope}:${slug}` });
  }
  S.draft = null; S.errors = {};
  toast(t(stale ? "toast.savedStale" : d.forkedFrom && !editing ? "toast.forked" : "toast.saved")); go("#/");
}

// ── Auth gate ──
function gateView(kind) {
  const card = h("div", { class: "card" }, h("span", { class: "brand-mark", "aria-hidden": "true", style: "width:2.5rem;height:2.5rem" }, icon("people")));
  if (kind === "signin") {
    const btn = h("button", { type: "button", class: "btn btn-primary", "data-testid": "signin", onclick: () => {
      btn.disabled = true; btn.textContent = t("auth.redirecting"); announce(t("auth.redirecting"));
      setTimeout(() => go("#/"), 1200);
    } }, t("auth.signIn"));
    card.append(h("h1", { text: t("auth.title") }), h("p", { text: t("auth.body") }), btn);
  } else if (kind === "signinUnavailable") {
    card.append(h("h1", { text: t("auth.title") }),
      h("div", { class: "callout callout-error", role: "alert" }, icon("alert", "ic sm"), h("div", { class: "grow" }, h("p", {}, h("strong", { text: t("auth.unavailable") })), h("p", { text: t("auth.unavailableDetail") }))),
      h("button", { type: "button", class: "btn btn-secondary", onclick: () => go("#/signin") }, icon("refresh", "ic sm"), t("grid.retry")));
  } else {
    card.append(h("h1", { text: t("app.name") }),
      h("div", { class: "callout callout-warning", role: "alert" }, icon("warning", "ic sm"), h("div", { class: "grow" }, h("p", {}, h("strong", { text: t("auth.notAdmitted") })), h("p", { text: t("auth.notAdmittedDetail") }))));
  }
  return h("div", { class: "gate" }, card);
}

// ── Render ──
// ── Folder entry (D17): dashboard sidebar mock + content-area placement like the OpenSpec board ──
const FOLDERS = [
  { cwd: "/repo/billing-api/packages/core", name: "core", parent: "billing-api", sessions: ["Számlalista gyorsítása"] },
  { cwd: "/repo/crm-web", name: "crm-web", sessions: ["Ügyféllista export"] },
  { cwd: "/repo/marketing-site", name: "marketing-site", sessions: ["Landing szövegek"] },
];
const KNOWN_USERS = [{ sub: "anna", name: "Kovács Anna" }, { sub: "bela", name: "Nagy Béla" }, { sub: "csilla", name: "Szabó Csilla" }];
const canManage = () => S.mode === "single" || isAdmin();
function matchFolder(cwd) { // equal realpath, else nearest containing project; allowed projects only
  if (!cwd) return null;
  return allowedProjects().filter((x) => cwd === x.path || cwd.startsWith(x.path + "/")).sort((a, b) => b.path.length - a.path.length)[0] || null;
}
const activeIn = (id) => Object.entries(S.convs).filter(([k]) => k.endsWith(`|${id}`)).flatMap(([, l]) => l).filter((c) => !c.archived && (c.status === "running" || c.status === "busy")).length;
function openFolderTeam(f) { S.folder = f.cwd; store.set("team:folder", f.cwd); S.host = "folder"; store.set("team:host", "folder"); S.focusAfter = null; go("#/"); render(); }
function folderSidebar() {
  return h("nav", { class: "dash-sidebar", "aria-label": t("fold.sidebar") },
    h("p", { class: "dash-note", text: t("fold.note") }),
    h("button", { type: "button", class: `dash-global${S.host === "embedded" ? " is-current" : ""}`, "data-testid": "global-team-entry", "aria-current": S.host === "embedded" ? "page" : null,
      onclick: () => { S.host = "embedded"; store.set("team:host", "embedded"); go("#/"); render(); } },
      icon("people", "ic sm"), h("span", { class: "grow", text: t("fold.global") }), h("span", { class: "dash-slot", text: t("fold.slotNote") }), h("span", { "aria-hidden": "true", text: "→" })),
    ...FOLDERS.map((f) => {
      const m = matchFolder(f.cwd);
      const items = [{ k: "fold.pin", ic: "pin", act: () => toast(t("fold.pin")) }];
      if (m) items.unshift({ k: "fold.open", ic: "people", act: () => openFolderTeam(f) });
      if (m && m.source === "folder" && canManage()) items.push("sep", { k: "fold.settings", ic: "edit", act: () => projectDialog(f, m) }, { k: "fold.disable", ic: "trash", danger: true, act: () => disableProject(f, m) });
      if (!m && canManage()) items.push("sep", { k: "fold.enable", ic: "plus", act: () => projectDialog(f, null) });
      const current = S.folder === f.cwd;
      return h("section", { class: `dash-folder${current ? " is-current" : ""}`, "data-folder": f.name, "aria-label": f.name },
        h("div", { class: "dash-folder-head" }, icon("folder", "ic sm"),
          h("span", { class: "dash-folder-name" }, f.parent ? h("span", { class: "dash-parent", text: `${f.parent}/…/` }) : null, f.name),
          menuButton(t("fold.menu", { name: f.name }), items, `m-fold-${f.name}`, { testid: `folder-menu-${f.name}` })),
        h("span", { class: "dash-row muted", text: "OpenSpec · 2" }),
        m ? h("button", { type: "button", class: `dash-row dash-team${current ? " is-current" : ""}`, "data-testid": `team-row-${f.name}`, "aria-current": current ? "page" : null, onclick: () => openFolderTeam(f) },
          icon("people", "ic sm"), t("fold.teamRow", { n: agentsFor(m.id).length, a: activeIn(m.id) })) : null,
        ...f.sessions.map((x) => h("span", { class: "dash-session", text: x })));
    }));
}
// EmbeddedApp's board-style top bar (add-plugin-app-host): Back · breadcrumb · HeaderContext · ≤2 actions · Open standalone.
function embeddedTopBar(m) {
  const folderMode = S.host === "folder";
  const f = folderMode && FOLDERS.find((x) => x.cwd === S.folder);
  return h("div", { class: "folder-app-head", "data-testid": "embedded-topbar" },
    h("button", { type: "button", class: "btn btn-ghost", onclick: () => toast(folderMode ? t("toast.toFolder") : t("host.backTo")), "data-testid": "folder-back" },
      icon("back", "ic sm"), folderMode ? t("fold.back", { name: f?.name ?? m.name }) : t("host.back")),
    h("nav", { class: "ea-crumb", "aria-label": t("host.crumb") },
      folderMode ? h("span", { class: "ea-folder", text: f?.name ?? m.name }) : null, folderMode ? h("span", { "aria-hidden": "true", text: "›" }) : null,
      h("span", { class: "fa-title", text: t("app.name") })),
    h("div", { class: "header-target" }, targetSelector()),
    h("span", { class: "fa-full" }),
    folderMode ? h("a", { class: "btn btn-ghost", href: "#/", "data-testid": "full-team", onclick: (e) => { e.preventDefault(); setTarget(m.id); S.host = "embedded"; store.set("team:host", "embedded"); go("#/"); render(); } }, icon("people", "ic sm"), t("fold.full")) : null,
    h("button", { type: "button", class: "btn btn-ghost", onclick: () => toast(t("toast.standalone")), "data-testid": "open-standalone" }, icon("openExt", "ic sm"), t("host.standalone")));
}
function slugify(x) { return x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "projekt"; }
function projectDialog(f, existing) { // enable (POST /projects) or settings (PATCH) — D17
  const d = dlg(); const opener = document.activeElement;
  d.querySelector("#dlgTitle").textContent = t(existing ? "fold.dlgSettings" : "fold.dlgTitle", { name: f.name });
  const multi = S.mode === "multi";
  const sel = existing && Array.isArray(existing.users) ? existing.users : [];
  const nameIn = h("input", { class: "input", id: "dlgName", value: existing?.name ?? f.name, maxlength: "60", "aria-describedby": "dlgNameHint" });
  const nameErr = h("p", { class: "field-error", id: "dlgNameErr", hidden: true, text: t("fold.errName") });
  const radio = (v, k) => h("label", { class: "check" }, h("input", { type: "radio", name: "dlgWho", value: v, checked: (existing && Array.isArray(existing.users) ? "sel" : "all") === v ? true : null, onchange: () => { users.hidden = v !== "sel"; } }), t(k));
  const users = h("div", { class: "check-list", id: "dlgUsers", hidden: !(existing && Array.isArray(existing.users)) },
    ...KNOWN_USERS.map((u) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "dlgUser", value: u.sub, checked: sel.includes(u.sub) ? true : null }), u.name)),
    h("p", { class: "hint", text: t("fold.usersHint") }));
  const usersErr = h("p", { class: "field-error", id: "dlgUsersErr", hidden: true, text: t("fold.errUsers") });
  const ctx = h("input", { type: "checkbox", id: "dlgCtx", checked: existing?.contextFiles ? true : null, "aria-describedby": "dlgCtxHint" });
  d.querySelector("#dlgBody").replaceChildren(...[ // filter: replaceChildren(null) would print "null" (F2)
    h("div", { class: "field" }, h("label", { for: "dlgName", text: t("fold.name") }), nameIn, h("p", { class: "hint", id: "dlgNameHint", text: t("fold.nameHint") }), nameErr),
    multi ? h("fieldset", { class: "field" }, h("legend", { text: t("fold.who") }), radio("all", "fold.everyone"), radio("sel", "fold.selected"), users, usersErr) : null,
    h("div", { class: "field" }, h("label", { class: "check" }, ctx, t("fold.ctx")), h("p", { class: "hint", id: "dlgCtxHint", text: t("fold.ctxHint") })),
  ].filter(Boolean));
  d.querySelector("#dlgCancel").textContent = t("dlg.cancel");
  const ok = d.querySelector("#dlgOk"); ok.textContent = t(existing ? "fold.save" : "fold.ok"); ok.className = "btn btn-primary";
  ok.onclick = () => {
    const name = nameIn.value.trim();
    const who = d.querySelector("input[name=dlgWho]:checked")?.value ?? "all";
    const picked = [...d.querySelectorAll("input[name=dlgUser]:checked")].map((x) => x.value);
    nameErr.hidden = !!name; nameIn.setAttribute("aria-invalid", String(!name)); if (!name) nameIn.setAttribute("aria-describedby", "dlgNameHint dlgNameErr");
    const usersBad = multi && who === "sel" && !picked.length; usersErr.hidden = !usersBad;
    if (!name) { nameIn.focus(); return; }
    if (usersBad) { d.querySelector("input[name=dlgUser]")?.focus(); return; }
    const usersVal = multi && who === "sel" ? picked : "*";
    if (existing) { Object.assign(existing, { name, users: usersVal, contextFiles: ctx.checked }); toast(t("toast.projSaved")); d.close(); render(); return; }
    let id = slugify(f.name), n = 2; while (PROJECTS.some((x) => x.id === id)) id = `${slugify(f.name)}-${n++}`;
    PROJECTS.push({ id, name, path: f.cwd, source: "folder", users: usersVal, contextFiles: ctx.checked });
    toast(t("toast.enabled", { name })); d.close(); openFolderTeam(f);
  };
  d.querySelector("#dlgCancel").onclick = () => d.close();
  d.onclose = () => { if (opener && document.contains(opener)) opener.focus(); };
  d.showModal(); nameIn.focus();
}
function disableProject(f, m) {
  confirmDialog(t("fold.disTitle", { name: m.name }), t("fold.disBody"), t("fold.disOk"), () => {
    PROJECTS.splice(PROJECTS.indexOf(m), 1); toast(t("toast.disabled")); render();
  });
}
function addAgentsDialog(tg) {
  const d = dlg(); const opener = document.activeElement;
  const cands = S.personas.filter((p) => p.scope === "shared" && !p.retired && !p.projects.includes(tg));
  d.querySelector("#dlgTitle").textContent = t("dlg.add.title", { name: targetName(tg) });
  d.querySelector("#dlgBody").replaceChildren(cands.length
    ? h("div", { class: "check-list" }, ...cands.map((p) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "dlgAdd", value: p.key }), p.name)))
    : h("p", { text: t("dlg.add.none") }));
  d.querySelector("#dlgCancel").textContent = t("dlg.cancel");
  const ok = d.querySelector("#dlgOk"); ok.textContent = t("dlg.add.ok"); ok.className = "btn btn-primary";
  ok.onclick = () => {
    const keys = [...d.querySelectorAll("input[name=dlgAdd]:checked")].map((x) => x.value);
    for (const k of keys) S.personas.find((p) => p.key === k).projects.push(tg);
    d.close(); toast(t("toast.added", { n: keys.length })); render();
  };
  d.querySelector("#dlgCancel").onclick = () => d.close();
  d.onclose = () => { if (opener && document.contains(opener)) opener.focus(); };
  d.showModal(); (d.querySelector("input[name=dlgAdd]") || d.querySelector("#dlgCancel")).focus();
}

function render() {
  const app = document.getElementById("app");
  const ed = app.querySelector("form[data-testid=persona-form]");
  if (ed?._draft) readForm(ed, ed._draft); // keep typed values across lang/theme re-render
  const focusId = document.activeElement?.id;
  const r = route();
  document.documentElement.lang = S.lang;
  document.documentElement.dataset.theme = S.theme;
  const gate = r.name === "signin" || r.name === "signinUnavailable" || r.name === "notAdmitted";
  const view = gate ? gateView(r.name) : r.name === "agent" ? agentView(r) : r.name === "editor" ? editorView(r) : gridView();
  document.title = `${t("app.name")}: mockup`;
  const main = h("main", { id: "main", style: r.name === "agent" ? "display:flex;flex-direction:column;min-height:0" : "" }, view);
  if ((S.host === "folder" || S.host === "embedded") && !gate) { // embedded like the OpenSpec board: sidebar stays, app in the content area
    const m = S.host === "folder" ? matchFolder(S.folder) : true;
    app.replaceChildren(h("div", { class: "folder-layout" }, folderSidebar(),
      h("div", { class: "folder-content" }, ...(m ? [embeddedTopBar(m), main] : [h("main", { id: "main" }, h("div", { class: "page" }, h("p", { class: "hint", text: t("fold.pick") })))]))));
  } else app.replaceChildren(header(gate), main);
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
}
function setLang(l) { S.lang = l; store.set("team:lang", l); render(); document.querySelector(`[data-testid=lang-${l}]`)?.focus(); }
function toggleTheme() { S.theme = S.theme === "dark" ? "light" : "dark"; store.set("team:theme", S.theme); render(); document.querySelector("[data-testid=theme-toggle]")?.focus(); }


// ── Mock controls wiring ──
function refocus() { if (S.focusAfter) { document.getElementById(S.focusAfter)?.focus(); S.focusAfter = null; } }
function syncMock() {
  const scr = document.getElementById("mScreen");
  if ([...scr.options].some((o) => o.value === location.hash)) scr.value = location.hash;
  document.getElementById("mConvo").value = S.convo;
  document.getElementById("mHost").value = S.host;
}
document.getElementById("mScreen").addEventListener("change", (e) => {
  S.draft = null; const v = e.target.value;
  const m = /[?&]target=([^&]+)/.exec(v); if (m) setTarget(m[1]);
  go(v.replace(/[?&]target=[^&]+/, ""));
});
document.getElementById("mRole").addEventListener("change", (e) => { S.role = e.target.value; S.draft = null; render(); });
document.getElementById("mMode").addEventListener("change", (e) => { S.mode = e.target.value; S.draft = null; render(); });
document.getElementById("mHost").addEventListener("change", (e) => { S.host = e.target.value; store.set("team:host", S.host); render(); });
document.getElementById("mProjects").addEventListener("change", (e) => { S.projects = e.target.value; render(); });
document.getElementById("mLimit").addEventListener("change", (e) => { S.limit = e.target.checked; render(); });
document.getElementById("mGrid").addEventListener("change", (e) => { S.grid = e.target.value; if (route().name !== "grid") go("#/"); else render(); });
document.getElementById("mConvo").addEventListener("change", (e) => { S.convo = e.target.value; if (route().name !== "agent") { setTarget("billing"); go("#/agent/shared:backend/c/c1"); } else render(); });
window.addEventListener("hashchange", () => { S.errors = {}; syncMock(); render(); window.scrollTo(0, 0);
  document.getElementById("main")?.querySelector("h1")?.setAttribute("tabindex", "-1");
  refocus(); // keep focus on the control that caused the navigation (WCAG 2.4.3)
});
window.__I18N = I18N; // for ux-probe key-parity check
syncMock(); render();
