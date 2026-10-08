/* add-team-skill-access mockup. Vanilla JS, no deps. Reuses the add-team-plugin recipes (mockup.css).
   Skill names, descriptions and persona content are data: never translated. */
"use strict";

const I18N = {
  hu: {
    "app.name": "AI Csapat", "lang.group": "Nyelv", "theme.toLight": "Váltás világos témára", "theme.toDark": "Váltás sötét témára",
    "user.local": "Helyi operátor", "user.admin": "admin",
    "grid.title": "Csapat", "grid.subtitle": "A csapat itt: {t}", "grid.new": "Új persona", "grid.skills": "Képességek",
    "grid.shared": "Közös sablonok",
    "status.sleeping": "Alszik", "status.running": "Fut", "status.unavailable": "Nem elérhető",
    "card.talk": "Beszélgetés", "card.more": "További műveletek: {name}", "card.skillsN": "{n} képesség",
    "card.blocked.targets": "Nem indítható: a(z) {s} képesség itt már nem engedélyezett.", "card.blocked.invalid": "Nem indítható: a(z) {s} képesség útvonala érvénytelen.", "card.blocked.users": "Nem indítható neked: a(z) {s} képességet nem használhatod.",
    "card.blockedFix": "Persona javítása", "card.blockedFixSkill": "Képesség javítása", "card.blockedAsk": "Szólj az adminisztrátornak.",
    "sk.title": "Képességek", "sk.subtitle": "Melyik képességet ki és hol használhatja a csapat ügynökeiben.",
    "sk.add": "Képesség hozzáadása", "sk.back": "Vissza a csapathoz", "sk.backList": "Vissza a képességekhez",
    "sk.col.skill": "Képesség", "sk.col.users": "Kik", "sk.col.where": "Hol", "sk.col.actions": "Műveletek",
    "sk.src.config": "Konfig", "sk.src.managed": "Kezelt",
    "sk.everyone": "Mindenki", "sk.everywhere": "Mindenhol", "sk.nUsers": "{n} felhasználó",
    "sk.notApplicable": "Nem korlátozott (egyfelhasználós mód)",
    "sk.invalid": "Útvonal érvénytelen", "sk.invalidHint": "Nem indul vele beszélgetés, amíg az útvonalat nem javítod.",
    "sk.usage": "{p} persona · {l} élő munkamenet", "sk.readonly": "Konfigurációból, csak olvasható",
    "sk.edit": "Szerkesztés", "sk.remove": "Eltávolítás", "sk.rowMenu": "Műveletek: {name}",
    "sk.empty": "Még nincs engedélyezett képesség. Az ügynökök addig képességek nélkül futnak.",
    "sk.emptyCta": "Első képesség hozzáadása",
    "sk.newTitle": "Képesség hozzáadása", "sk.editTitle": "Képesség: {name}", "sk.viewTitle": "Képesség: {name}",
    "sk.source": "Forrás", "sk.srcPick": "Telepített képesség", "sk.srcPickDesc": "A gépen telepített képességek közül.",
    "sk.srcPath": "Útvonal megadása", "sk.srcPathDesc": "Abszolút útvonal egy SKILL.md mappához vagy .md fájlhoz.",
    "sk.search": "Keresés név vagy leírás alapján", "sk.inCatalog": "Már a katalógusban",
    "sk.path": "Útvonal", "sk.pathHint": "Nem lehet projekt mappájában vagy a csapat munkaterületén belül.",
    "sk.name": "Név", "sk.nameHint": "Kisbetű, szám, kötőjel. Ezt választják ki a personák.", "sk.nameFixed": "A név mentés után nem változtatható.",
    "sk.users": "Kik használhatják", "sk.usersAll": "Mindenki, aki bejelentkezett", "sk.usersAllDesc": "Minden felhasználó personáiban választható.",
    "sk.usersSome": "Kiválasztott felhasználók", "sk.usersSomeDesc": "Csak az ő saját personáikban, és a közös sablonokkal csak nekik indul.",
    "sk.usersSingle": "Egyfelhasználós módban nincs felhasználói korlát.",
    "sk.where": "Hol használható", "sk.whereAll": "Minden projektben és munkaterületen", "sk.whereAllDesc": "Új projektekre is érvényes.",
    "sk.whereSome": "Kiválasztott helyeken", "sk.whereSomeDesc": "Csak a bejelölt projektekben és munkaterületen.",
    "sk.impactTitle": "Mentéskor:", "sk.impactLive": "{n} élő munkamenet leáll. A beszélgetések megmaradnak, újranyitáskor folytatódnak.",
    "sk.impactBlocked": "Ezek a personák egy helyen hivatkoznak rá, ahol már nem lesz engedélyezett. Ott nem indulnak, amíg nem javítod őket:",
    "sk.impactPrivate": "+ {n} saját persona más felhasználóktól",
    "sk.save": "Mentés", "sk.cancel": "Mégse",
    "sk.err.summary": "A mentés nem sikerült", "sk.err.name": "A név már létezik a katalógusban.",
    "sk.err.path": "Az útvonal egy projekt mappájában van. Válassz a projekteken kívüli helyet.",
    "sk.err.users": "Válassz legalább egy felhasználót.", "sk.err.where": "Válassz legalább egy helyet.",
    "dlg.cancel": "Mégse", "dlg.remove.title": "Eltávolítod: {name}?",
    "dlg.remove.body": "{p} persona hivatkozik rá. {l} élő munkamenet leáll; a beszélgetések megmaradnak. A personák javításig nem indulnak.",
    "dlg.remove.ok": "Eltávolítás és munkamenetek leállítása",
    "dlg.save.title": "Mented a változást?", "dlg.save.body": "{l} élő munkamenet leáll. A beszélgetések megmaradnak.", "dlg.save.ok": "Mentés és leállítás",
    "toast.saved": "Mentve. {l} munkamenet leállt.", "toast.removed": "Eltávolítva.",
    "ed.title": "Persona szerkesztése", "ed.newTitle": "Új persona", "ed.back": "Vissza a csapathoz",
    "ed.projects": "Projektek", "ed.projectsHint": "Hol jelenjen meg és hol indíthasson beszélgetést.",
    "ed.skills": "Képességek", "ed.skillsHint": "Csak azok választhatók, amelyek minden bejelölt helyen engedélyezettek.",
    "ed.skillOnly": "Csak itt: {list}", "ed.skillNotHere": "Nem engedélyezett itt: {list}",
    "ed.skillRemoved": "Kivettük: {name}. Itt nem engedélyezett: {list}.",
    "ed.skillsEmptyAdmin": "Még nincs engedélyezett képesség.", "ed.skillsEmptyLink": "Képességek kezelése",
    "ed.save": "Mentés", "ed.cancel": "Mégse", "ed.name": "Név",
    "target.ws": "Saját munkaterület",
    "cv.back": "Beszélgetések", "cv.placeholder": "Üzenet ennek: {name}", "cv.send": "Küldés",
    "cv.skillRefused": "A(z) {s} képesség nem érhető el ennek az ügynöknek. Az üzenet nem lett elküldve.",
    "cv.skillAvail": "Elérhető: {list}", "cv.skillNone": "Ennek az ügynöknek nincs képessége.",
    "cv.blockedTitle": "A beszélgetés nem indítható.",
    "cv.blockedBody.targets": "A(z) {s} képesség ebben a projektben már nem engedélyezett. Az előzmények megmaradtak.", "cv.blockedBody.invalid": "A(z) {s} képesség útvonala érvénytelen, ezért nem tölthető be. Az előzmények megmaradtak.", "cv.blockedBody.users": "A(z) {s} képességet nem használhatod. Az előzmények megmaradtak.",
    "cv.blockedAdmin": "Persona javítása", "cv.blockedFixSkill": "Képesség javítása", "cv.blockedMember": "Szólj az adminisztrátornak, hogy engedélyezze, vagy vegye ki a personából.",
  },
  en: {
    "app.name": "AI Team", "lang.group": "Language", "theme.toLight": "Switch to light theme", "theme.toDark": "Switch to dark theme",
    "user.local": "Local operator", "user.admin": "admin",
    "grid.title": "Team", "grid.subtitle": "Team here: {t}", "grid.new": "New persona", "grid.skills": "Skills",
    "grid.shared": "Shared templates",
    "status.sleeping": "Sleeping", "status.running": "Running", "status.unavailable": "Unavailable",
    "card.talk": "Chat", "card.more": "More actions: {name}", "card.skillsN": "{n} skills",
    "card.blocked.targets": "Cannot start: skill {s} is no longer allowed here.", "card.blocked.invalid": "Cannot start: the path of skill {s} is invalid.", "card.blocked.users": "Cannot start for you: you may not use skill {s}.",
    "card.blockedFix": "Fix persona", "card.blockedFixSkill": "Fix skill", "card.blockedAsk": "Ask your administrator.",
    "sk.title": "Skills", "sk.subtitle": "Which skill who may use where, in the team's agents.",
    "sk.add": "Add skill", "sk.back": "Back to the team", "sk.backList": "Back to skills",
    "sk.col.skill": "Skill", "sk.col.users": "Who", "sk.col.where": "Where", "sk.col.actions": "Actions",
    "sk.src.config": "Config", "sk.src.managed": "Managed",
    "sk.everyone": "Everyone", "sk.everywhere": "Everywhere", "sk.nUsers": "{n} users",
    "sk.notApplicable": "Not restricted (single-user mode)",
    "sk.invalid": "Path invalid", "sk.invalidHint": "No conversation starts with it until the path is fixed.",
    "sk.usage": "{p} personas · {l} live sessions", "sk.readonly": "From config, read-only",
    "sk.edit": "Edit", "sk.remove": "Remove", "sk.rowMenu": "Actions: {name}",
    "sk.empty": "No skill is allowed yet. Agents run without skills until you add one.",
    "sk.emptyCta": "Add the first skill",
    "sk.newTitle": "Add skill", "sk.editTitle": "Skill: {name}", "sk.viewTitle": "Skill: {name}",
    "sk.source": "Source", "sk.srcPick": "Installed skill", "sk.srcPickDesc": "From the skills installed on this machine.",
    "sk.srcPath": "Enter a path", "sk.srcPathDesc": "Absolute path to a SKILL.md folder or an .md file.",
    "sk.search": "Search by name or description", "sk.inCatalog": "Already in the catalog",
    "sk.path": "Path", "sk.pathHint": "Must not be inside a project folder or the team workspace.",
    "sk.name": "Name", "sk.nameHint": "Lowercase, digits, hyphen. Personas pick this name.", "sk.nameFixed": "The name cannot change after saving.",
    "sk.users": "Who may use it", "sk.usersAll": "Everyone signed in", "sk.usersAllDesc": "Selectable in every user's personas.",
    "sk.usersSome": "Selected users", "sk.usersSomeDesc": "Only in their own personas, and shared templates start with it only for them.",
    "sk.usersSingle": "Single-user mode has no user restriction.",
    "sk.where": "Where it can be used", "sk.whereAll": "In every project and workspace", "sk.whereAllDesc": "Also applies to new projects.",
    "sk.whereSome": "In selected places", "sk.whereSomeDesc": "Only in the ticked projects and workspace.",
    "sk.impactTitle": "On save:", "sk.impactLive": "{n} live sessions end. Conversations are kept and resume when reopened.",
    "sk.impactBlocked": "These personas use it in a place where it will no longer be allowed. They will not start there until fixed:",
    "sk.impactPrivate": "+ {n} private personas of other users",
    "sk.save": "Save", "sk.cancel": "Cancel",
    "sk.err.summary": "Could not save", "sk.err.name": "That name already exists in the catalog.",
    "sk.err.path": "The path is inside a project folder. Choose a place outside projects.",
    "sk.err.users": "Pick at least one user.", "sk.err.where": "Pick at least one place.",
    "dlg.cancel": "Cancel", "dlg.remove.title": "Remove {name}?",
    "dlg.remove.body": "{p} personas use it. {l} live sessions end; conversations are kept. The personas will not start until fixed.",
    "dlg.remove.ok": "Remove and end sessions",
    "dlg.save.title": "Save the change?", "dlg.save.body": "{l} live sessions end. Conversations are kept.", "dlg.save.ok": "Save and end sessions",
    "toast.saved": "Saved. {l} sessions ended.", "toast.removed": "Removed.",
    "ed.title": "Edit persona", "ed.newTitle": "New persona", "ed.back": "Back to the team",
    "ed.projects": "Projects", "ed.projectsHint": "Where it appears and can start conversations.",
    "ed.skills": "Skills", "ed.skillsHint": "Only skills allowed in every ticked place can be chosen.",
    "ed.skillOnly": "Only in: {list}", "ed.skillNotHere": "Not allowed in: {list}",
    "ed.skillRemoved": "Removed {name}. Not allowed in: {list}.",
    "ed.skillsEmptyAdmin": "No skill is allowed yet.", "ed.skillsEmptyLink": "Manage skills",
    "ed.save": "Save", "ed.cancel": "Cancel", "ed.name": "Name",
    "target.ws": "Own workspace",
    "cv.back": "Conversations", "cv.placeholder": "Message {name}", "cv.send": "Send",
    "cv.skillRefused": "Skill {s} is not available to this agent. The message was not sent.",
    "cv.skillAvail": "Available: {list}", "cv.skillNone": "This agent has no skills.",
    "cv.blockedTitle": "This conversation cannot start.",
    "cv.blockedBody.targets": "Skill {s} is no longer allowed in this project. The history is kept.", "cv.blockedBody.invalid": "The path of skill {s} is invalid, so it cannot load. The history is kept.", "cv.blockedBody.users": "You may not use skill {s}. The history is kept.",
    "cv.blockedAdmin": "Fix persona", "cv.blockedFixSkill": "Fix skill", "cv.blockedMember": "Ask your administrator to allow it or remove it from the persona.",
  },
};

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>', more: '<path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3"/>',
  back: '<path d="M15 18l-6-6 6-6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>', chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};

// ── Mock data ──
const PROJECTS = [{ id: "billing", name: "billing-api" }, { id: "crm", name: "crm-web" }, { id: "_ws", name: null }];
const USERS = [{ id: "alice", name: "Kiss Anna" }, { id: "bob", name: "Nagy Bence" }, { id: "cecil", name: "Szabó Cecília" }];
const CATALOG0 = [
  { name: "review", source: "managed", path: "/Users/op/.pi/agent/skills/review", desc: "Code review checklist: correctness, tests, naming, security.", users: "*", targets: ["billing"], personas: ["shared:backend", "private:kodbiralo"], privateOthers: 1, live: 2, valid: true },
  { name: "openspec-propose", source: "config", path: "/work/skills/openspec-propose", desc: "Draft an OpenSpec change with proposal, design, specs and tasks.", users: "*", targets: "*", personas: ["shared:backend"], privateOthers: 0, live: 1, valid: true },
  { name: "release-notes", source: "managed", path: "/Users/op/.pi/agent/skills/release-notes", desc: "Write user-facing release notes from a changelog.", users: ["bob", "cecil"], targets: ["_ws"], personas: [], privateOthers: 2, live: 0, valid: true },
  { name: "legacy-lint", source: "managed", path: "/opt/old/legacy-lint", desc: "Lint rules for the old portal.", users: "*", targets: ["crm"], personas: ["shared:elemzo"], privateOthers: 0, live: 0, valid: false },
];
const AVAILABLE = [
  { name: "review", desc: "Code review checklist: correctness, tests, naming, security.", path: "/Users/op/.pi/agent/skills/review", src: "~/.pi/agent/skills" },
  { name: "doc-summarizer", desc: "Summarize documents of any size with chunked extraction.", path: "/Users/op/.pi/agent/skills/doc-summarizer", src: "~/.pi/agent/skills" },
  { name: "mermaid-md-doctor", desc: "Detect and fix Mermaid diagrams that do not render.", path: "/Users/op/.pi/agent/skills/mermaid-md-doctor", src: "~/.pi/agent/skills" },
  { name: "scenario-design", desc: "Draft real-life test scenarios from a change spec.", path: "/Users/op/.pi/agent/npm/node_modules/eng-disciplines/.pi/skills/scenario-design", src: "eng-disciplines (csomag)" },
];
const PERSONAS = {
  "shared:backend": { key: "shared:backend", name: "Backend fejlesztő", desc: "API-k, adatbázis-migrációk, tesztek.", tint: "blue", mono: "BF", status: "running", projects: ["billing"], skills: ["review", "openspec-propose"] },
  "shared:elemzo": { key: "shared:elemzo", name: "Üzleti elemző", desc: "Követelmények, folyamatok, döntési táblák.", tint: "green", mono: "ÜE", status: "unavailable", projects: ["billing", "crm"], skills: ["legacy-lint"], blocked: { skill: "legacy-lint", reason: "invalid" } },
  "shared:iro": { key: "shared:iro", name: "Dokumentáció író", desc: "README, változásnapló, felhasználói leírás.", tint: "purple", mono: "DI", status: "sleeping", projects: ["billing", "_ws"], skills: [] },
};

// ── State ──
const S = { lang: "hu", theme: "dark", role: "admin", mode: "multi", catalog: "some", route: "#/", draft: null, edDraft: null, edNote: null, cvError: null, cvText: "/skill:memory-x foglald össze a heti változásokat" };
const $ = (s) => document.querySelector(s);
const t = (k, v) => { let s = I18N[S.lang][k]; if (s == null) { console.warn("missing i18n", k); s = k; } return v ? s.replace(/\{(\w+)\}/g, (_, x) => v[x]) : s; };
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v; else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
function icon(n, cls = "ic") { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.innerHTML = ICON[n]; return s; }
const isAdmin = () => S.mode === "single" || S.role === "admin";
const catalog = () => (S.catalog === "empty" ? [] : CATALOG0);
const tName = (id) => (id === "_ws" ? t("target.ws") : PROJECTS.find((p) => p.id === id)?.name ?? id);
const listNames = (ids) => ids.map(tName).join(", ");
const go = (hash) => { location.hash = hash; };
function announce(msg) { const a = $("#announce"); a.textContent = ""; setTimeout(() => (a.textContent = msg), 30); }
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3500); }
function allowedIn(entry, target) { return entry.targets === "*" || entry.targets.includes(target); }
function allowedFor(entry, uid) { return S.mode === "single" || entry.users === "*" || entry.users.includes(uid); }

// ── Dialog ──
function confirmDlg(title, body, ok, onOk) {
  const d = $("#confirmDialog"); $("#dlgTitle").textContent = title; $("#dlgBody").replaceChildren(h("p", { text: body }));
  $("#dlgCancel").textContent = t("dlg.cancel"); $("#dlgOk").textContent = ok;
  const opener = document.activeElement;
  $("#dlgCancel").onclick = () => d.close(); $("#dlgOk").onclick = () => { d.close(); onOk(); };
  d.addEventListener("close", () => opener?.focus?.(), { once: true });
  d.showModal(); $("#dlgCancel").focus();
}

// ── Menu (APG menu button, compact) ──
function menuButton(label, items, id) {
  const btn = h("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": id, "aria-label": label }, icon("more"));
  const list = h("ul", { class: "menu", role: "menu", id, "aria-label": label, hidden: true },
    ...items.map((it) => h("li", { role: "menuitem", tabindex: "-1", class: it.danger ? "danger" : "", onclick: () => { close(); it.act(); } }, icon(it.ic, "ic sm"), it.label)));
  const els = () => [...list.querySelectorAll('[role="menuitem"]')];
  const open = () => { document.querySelectorAll(".menu").forEach((m) => (m.hidden = true)); list.hidden = false; btn.setAttribute("aria-expanded", "true"); els()[0].focus(); };
  const close = (refocus = true) => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); };
  btn.onclick = () => (list.hidden ? open() : close());
  list.onkeydown = (e) => { const a = els(); const i = a.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); a[(i + 1) % a.length].focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); a[(i - 1 + a.length) % a.length].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement.click(); } };
  return h("div", { class: "menu-wrap" }, btn, list);
}

// ── Header ──
function header() {
  const lang = h("div", { class: "seg", role: "group", "aria-label": t("lang.group") },
    ...["hu", "en"].map((l) => h("button", { type: "button", lang: l, "aria-pressed": String(S.lang === l), text: l.toUpperCase(), onclick: () => { S.lang = l; document.documentElement.lang = l; render(); } })));
  const theme = h("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.theme === "dark" ? t("theme.toLight") : t("theme.toDark"),
    onclick: () => { S.theme = S.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = S.theme; render(); } }, icon(S.theme === "dark" ? "sun" : "moon"));
  const who = S.mode === "single" ? h("span", { class: "pill-local", text: t("user.local") })
    : h("span", { class: "user-chip" }, h("span", { class: "initials", "aria-hidden": "true", text: S.role === "admin" ? "KA" : "NB" }),
        h("span", { class: "user-name" }, S.role === "admin" ? "Kiss Anna" : "Nagy Bence", S.role === "admin" ? ` · ${t("user.admin")}` : ""));
  return h("header", { class: "app-header" },
    h("a", { class: "brand", href: "#/" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("people", "ic sm")), h("span", { text: t("app.name") })),
    h("div", { class: "header-end" }, lang, theme, who));
}

// ── Grid (excerpt: shows the entry point + blocked card) ──
function grid() {
  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", { class: "page-title", text: t("grid.title") }), h("p", { class: "subtitle", text: t("grid.subtitle", { t: "billing-api" }) })),
    h("div", { class: "chips" },
      isAdmin() ? h("button", { type: "button", class: "btn btn-secondary", onclick: () => go("#/skills"), "data-testid": "open-skills" }, icon("spark", "ic sm"), t("grid.skills")) : null,
      h("button", { type: "button", class: "btn btn-primary" }, icon("plus", "ic sm"), t("grid.new"))));
  const cards = Object.values(PERSONAS).filter((p) => p.projects.includes("billing")).map((p) => {
    const blocked = !!p.blocked;
    const st = h("span", { class: "status" }, h("span", { class: `shape shape-${p.status}`, "aria-hidden": "true" }), t(`status.${p.status}`));
    const chips = h("div", { class: "chips" }, h("span", { class: "chip", text: "Közös" }),
      p.skills.length ? h("span", { class: "chip", title: p.skills.join(", ") }, icon("spark", "ic sm"), t("card.skillsN", { n: p.skills.length })) : null);
    const actions = blocked
      ? h("div", { class: "card-actions" }, h("div", { class: "card-note-wrap" },
          h("div", { class: "callout callout-warning" }, icon("warning", "ic sm"), h("p", { text: t(`card.blocked.${p.blocked.reason}`, { s: p.blocked.skill }) })),
          isAdmin() ? (p.blocked.reason === "invalid" ? h("button", { type: "button", class: "btn btn-secondary", onclick: () => go(`#/skills/${p.blocked.skill}`) }, icon("spark", "ic sm"), t("card.blockedFixSkill")) : h("button", { type: "button", class: "btn btn-secondary", onclick: () => go(`#/personas/${p.key}`) }, icon("edit", "ic sm"), t("card.blockedFix")))
                    : h("p", { class: "card-note", text: t("card.blockedAsk") })))
      : h("div", { class: "card-actions" }, h("button", { type: "button", class: "btn btn-primary", onclick: () => go(`#/agent/${p.key}`) }, icon("chat", "ic sm"), t("card.talk")));
    return h("article", { class: "card agent-card", "aria-label": p.name },
      h("div", { class: "agent-top" }, h("span", { class: `avatar t-${p.tint}`, "aria-hidden": "true", text: p.mono }),
        h("div", { class: "agent-info" }, h("div", { class: "agent-name-row" }, h("h3", { class: "agent-name", text: p.name })), h("p", { class: "agent-desc", text: p.desc }), st, chips),
        menuButton(t("card.more", { name: p.name }), [{ label: "Szerkesztés", ic: "edit", act: () => go(`#/personas/${p.key}`) }], `m-${p.key}`)),
      actions);
  });
  return h("main", { class: "page", id: "main" }, head,
    h("section", { class: "section", "aria-labelledby": "sec-shared" }, h("div", { class: "section-head" }, h("h2", { class: "section-title", id: "sec-shared", text: t("grid.shared") })),
      h("div", { class: "grid" }, ...cards)));
}

// ── Skills panel: list ──
function usersCell(e) {
  if (S.mode === "single") return h("span", { class: "chip", text: t("sk.notApplicable") });
  return e.users === "*" ? h("span", { class: "chip", text: t("sk.everyone") })
    : h("span", { class: "chip", title: e.users.map((u) => USERS.find((x) => x.id === u).name).join(", "), text: t("sk.nUsers", { n: e.users.length }) });
}
function whereCell(e) {
  return e.targets === "*" ? h("span", { class: "chip", text: t("sk.everywhere") }) : h("div", { class: "chips" }, ...e.targets.map((x) => h("span", { class: "chip", text: tName(x) })));
}
function skillsList() {
  if (!isAdmin()) return h("main", { class: "page", id: "main" }, h("p", { text: "403 — admin only (not reachable from the UI for members)" }));
  const cat = catalog();
  const head = h("div", { class: "page-head" },
    h("div", {}, h("a", { class: "back-link", href: "#/" }, icon("back", "ic sm"), t("sk.back")),
      h("h1", { class: "page-title", text: t("sk.title") }), h("p", { class: "subtitle", text: t("sk.subtitle") })),
    cat.length ? h("button", { type: "button", class: "btn btn-primary", onclick: () => go("#/skills/new"), "data-testid": "add-skill" }, icon("plus", "ic sm"), t("sk.add")) : null);
  if (!cat.length) {
    return h("main", { class: "page", id: "main" }, head, h("div", { class: "card empty" }, h("p", { text: t("sk.empty") }),
      h("button", { type: "button", class: "btn btn-primary", onclick: () => go("#/skills/new") }, icon("plus", "ic sm"), t("sk.emptyCta"))));
  }
  const rows = cat.map((e) => {
    const actions = e.source === "config"
      ? h("span", { class: "lock-note", title: t("sk.readonly") }, icon("lock", "ic sm"), h("span", { class: "sr-only", text: t("sk.readonly") }))
      : menuButton(t("sk.rowMenu", { name: e.name }), [
          { label: t("sk.edit"), ic: "edit", act: () => go(`#/skills/${e.name}`) },
          { label: t("sk.remove"), ic: "trash", danger: true, act: () => confirmDlg(t("dlg.remove.title", { name: e.name }), t("dlg.remove.body", { p: e.personas.length + e.privateOthers, l: e.live }), t("dlg.remove.ok"), () => { toast(t("toast.removed")); announce(t("toast.removed")); }) },
        ], `sm-${e.name}`);
    return h("li", { class: `card skill-row${e.valid ? "" : " is-invalid"}`, "data-skill": e.name },
      h("div", { class: "skill-id" },
        h("div", { class: "chips" }, h("a", { class: "skill-name skill-link", href: `#/skills/${e.name}`, text: e.name }),
          h("span", { class: `chip src-${e.source}`, text: t(`sk.src.${e.source}`) }),
          e.valid ? null : h("span", { class: "chip warn" }, icon("warning", "ic sm"), t("sk.invalid"))),
        h("p", { class: "skill-desc", text: e.desc }),
        e.valid ? null : h("p", { class: "skill-desc", text: t("sk.invalidHint") }),
        h("p", { class: "skill-desc", text: t("sk.usage", { p: e.personas.length + e.privateOthers, l: e.live }) })),
      h("div", { class: "skill-cell" }, h("span", { class: "cell-label", text: t("sk.col.users") }), usersCell(e)),
      h("div", { class: "skill-cell" }, h("span", { class: "cell-label", text: t("sk.col.where") }), whereCell(e)),
      h("div", { class: "row-actions" }, actions));
  });
  return h("main", { class: "page", id: "main" }, head,
    h("div", { class: "list-head", "aria-hidden": "true" }, h("span", { text: t("sk.col.skill") }), h("span", { text: t("sk.col.users") }), h("span", { text: t("sk.col.where") }), h("span", {})),
    h("ul", { class: "skill-list", "aria-label": t("sk.title") }, ...rows));
}

// ── Skills panel: add / edit / view ──
function radioCard(name, value, checked, title, desc, onchange, disabled) {
  return h("label", { class: "radio-card" }, h("input", { type: "radio", name, value, checked, disabled, onchange }),
    h("span", {}, h("span", { class: "rc-title", text: title }), h("span", { class: "rc-desc", text: desc })));
}
function checkList(name, items, selected, onchange, disabled) {
  return h("div", { class: "check-list sub-list" }, ...items.map((it) => h("label", {},
    h("input", { type: "checkbox", name, value: it.id, checked: selected.includes(it.id), disabled, onchange: (e) => onchange(it.id, e.target.checked) }), it.label)));
}
function skillForm(nameParam) {
  if (!isAdmin()) return skillsList();
  const isNew = nameParam === "new";
  const entry = catalog().find((e) => e.name === nameParam);
  if (!isNew && !entry) return skillsList();
  const ro = !isNew && entry.source === "config";
  if (!S.draft || S.draft.for !== nameParam) {
    S.draft = isNew ? { for: "new", src: "pick", pick: null, path: "", name: "", users: "*", userList: [], targets: "some", targetList: ["billing"], errors: {} }
      : { for: nameParam, src: "pick", path: entry.path, name: entry.name, users: entry.users === "*" ? "*" : "some", userList: entry.users === "*" ? [] : [...entry.users],
          targets: entry.targets === "*" ? "*" : "some", targetList: entry.targets === "*" ? [] : [...entry.targets], errors: {} };
  }
  const d = S.draft;
  const rerender = () => { render(); };
  const fields = [];

  if (isNew) {
    const q = d.q ?? "";
    const avail = AVAILABLE.filter((a) => !q || (a.name + a.desc).toLowerCase().includes(q.toLowerCase()));
    fields.push(h("fieldset", { class: "field" }, h("legend", { text: t("sk.source") }),
      h("div", { class: "radio-cards cols-2" },
        radioCard("src", "pick", d.src === "pick", t("sk.srcPick"), t("sk.srcPickDesc"), () => { d.src = "pick"; rerender(); }),
        radioCard("src", "path", d.src === "path", t("sk.srcPath"), t("sk.srcPathDesc"), () => { d.src = "path"; rerender(); })),
      d.src === "pick"
        ? h("div", { class: "form", style: "gap:0.5rem" },
            h("div", { class: "picker-search" }, icon("search", "ic sm"), h("input", { class: "input", type: "search", "aria-label": t("sk.search"), placeholder: t("sk.search"), value: q,
              oninput: (e) => { d.q = e.target.value; const pos = e.target.selectionStart; rerender(); const i = document.querySelector(".picker-search input"); i.focus(); i.setSelectionRange(pos, pos); } })),
            h("div", { class: "picker", role: "radiogroup", "aria-label": t("sk.srcPick") }, ...avail.map((a) => {
              const taken = catalog().some((e) => e.name === a.name);
              return h("label", { class: "pick" }, h("input", { type: "radio", name: "pick", value: a.name, checked: d.pick === a.name, disabled: taken,
                  onchange: () => { d.pick = a.name; d.path = a.path; d.name = a.name; rerender(); } }),
                h("span", { class: "p-text" }, h("span", { class: "p-name", text: a.name }), h("span", { class: "p-desc", text: a.desc }),
                  h("span", { class: "p-meta", text: taken ? t("sk.inCatalog") : a.src })));
            })),
            d.pick ? h("p", { class: "path-line", text: d.path }) : null)
        : h("div", { class: `field${d.errors.path ? " has-error" : ""}` }, h("label", { for: "f-path", text: t("sk.path") }), h("p", { class: "hint", id: "path-hint", text: t("sk.pathHint") }),
            d.errors.path ? h("p", { class: "field-error", id: "path-err" }, icon("alert", "ic sm"), t("sk.err.path")) : null,
            h("input", { class: "input mono", id: "f-path", value: d.path, placeholder: "/opt/skills/review", "aria-describedby": d.errors.path ? "path-err path-hint" : "path-hint", oninput: (e) => { d.path = e.target.value; } }))));
  } else {
    fields.push(h("div", { class: "field" }, h("span", { class: "cell-label", style: "position:static;width:auto;height:auto", text: t("sk.path") }), h("p", { class: "path-line", text: entry.path }),
      entry.valid ? null : h("div", { class: "callout callout-warning" }, icon("warning", "ic sm"), h("p", { text: t("sk.invalidHint") }))));
  }

  if (isNew) fields.push(h("div", { class: `field${d.errors.name ? " has-error" : ""}` }, h("label", { for: "f-name", text: t("sk.name") }),
    h("p", { class: "hint", id: "name-hint", text: isNew ? t("sk.nameHint") : t("sk.nameFixed") }),
    d.errors.name ? h("p", { class: "field-error", id: "name-err" }, icon("alert", "ic sm"), t("sk.err.name")) : null,
    h("input", { class: "input mono", id: "f-name", value: d.name, readonly: !isNew, pattern: "[a-z0-9][a-z0-9-]{0,39}", "aria-describedby": "name-hint", oninput: (e) => { d.name = e.target.value; } })));

  if (S.mode === "single") {
    fields.push(h("div", { class: "field" }, h("span", { class: "rc-title", text: t("sk.users") }), h("p", { class: "hint", text: t("sk.usersSingle") })));
  } else {
    fields.push(h("fieldset", { class: `field${d.errors.users ? " has-error" : ""}` }, h("legend", { text: t("sk.users") }),
      d.errors.users ? h("p", { class: "field-error" }, icon("alert", "ic sm"), t("sk.err.users")) : null,
      h("div", { class: "radio-cards" },
        radioCard("users", "*", d.users === "*", t("sk.usersAll"), t("sk.usersAllDesc"), () => { d.users = "*"; rerender(); }, ro),
        radioCard("users", "some", d.users === "some", t("sk.usersSome"), t("sk.usersSomeDesc"), () => { d.users = "some"; rerender(); }, ro)),
      d.users === "some" ? checkList("userList", USERS.map((u) => ({ id: u.id, label: u.name })), d.userList, (id, on) => { d.userList = on ? [...d.userList, id] : d.userList.filter((x) => x !== id); rerender(); }, ro) : null));
  }

  fields.push(h("fieldset", { class: `field${d.errors.where ? " has-error" : ""}` }, h("legend", { text: t("sk.where") }),
    d.errors.where ? h("p", { class: "field-error" }, icon("alert", "ic sm"), t("sk.err.where")) : null,
    h("div", { class: "radio-cards" },
      radioCard("where", "*", d.targets === "*", t("sk.whereAll"), t("sk.whereAllDesc"), () => { d.targets = "*"; rerender(); }, ro),
      radioCard("where", "some", d.targets === "some", t("sk.whereSome"), t("sk.whereSomeDesc"), () => { d.targets = "some"; rerender(); }, ro)),
    d.targets === "some" ? checkList("targetList", PROJECTS.map((p) => ({ id: p.id, label: tName(p.id) })), d.targetList, (id, on) => { d.targetList = on ? [...d.targetList, id] : d.targetList.filter((x) => x !== id); rerender(); }, ro) : null));

  // Impact preview (edit only): live sessions + personas that become blocked (spec D5 strict).
  let impact = null;
  if (!isNew && !ro) {
    const newTargets = d.targets === "*" ? "*" : d.targetList;
    const changed = JSON.stringify(newTargets) !== JSON.stringify(entry.targets) || (d.users === "*" ? "*" : JSON.stringify(d.userList)) !== (entry.users === "*" ? "*" : JSON.stringify(entry.users));
    if (changed) {
      const blocked = entry.personas.map((k) => PERSONAS[k] || { key: k, name: k === "private:kodbiralo" ? "Kódbíráló (saját)" : k, projects: ["billing"] })
        .map((p) => ({ p, lost: newTargets === "*" ? [] : p.projects.filter((x) => !newTargets.includes(x)) })).filter((x) => x.lost.length);
      impact = h("div", { class: "callout callout-warning impact", role: "status" }, icon("warning", "ic sm"),
        h("div", { class: "grow" }, h("p", {}, h("strong", { text: t("sk.impactTitle") }), " ", t("sk.impactLive", { n: entry.live })),
          blocked.length ? h("p", { text: t("sk.impactBlocked") }) : null,
          blocked.length ? h("ul", {}, ...blocked.map((b) => h("li", {}, h("strong", { text: b.p.name }), ` — ${listNames(b.lost)}`)),
            entry.privateOthers ? h("li", { text: t("sk.impactPrivate", { n: entry.privateOthers }) }) : null) : null));
    }
  }

  const errs = Object.keys(d.errors);
  const summary = errs.length ? h("div", { class: "error-summary", tabindex: "-1", id: "err-summary", role: "alert" }, h("h2", { text: t("sk.err.summary") }),
    h("ul", {}, ...errs.map((k) => h("li", {}, h("a", { href: `#f-${k}`, onclick: (e) => { e.preventDefault(); document.getElementById(`f-${k}`)?.focus(); }, text: t(`sk.err.${k}`) }))))) : null;

  const save = () => {
    d.errors = {};
    if (isNew && d.src === "path" && d.path.startsWith("/work/billing")) d.errors.path = 1;
    if (isNew && catalog().some((e) => e.name === d.name)) d.errors.name = 1;
    if (S.mode !== "single" && d.users === "some" && !d.userList.length) d.errors.users = 1;
    if (d.targets === "some" && !d.targetList.length) d.errors.where = 1;
    if (Object.keys(d.errors).length) { render(); $("#err-summary")?.focus(); return; }
    const done = () => { const l = isNew ? 0 : entry.live; S.draft = null; go("#/skills"); toast(t("toast.saved", { l })); announce(t("toast.saved", { l })); };
    if (!isNew && entry.live > 0 && impact) confirmDlg(t("dlg.save.title"), t("dlg.save.body", { l: entry.live }), t("dlg.save.ok"), done); else done();
  };
  const title = isNew ? t("sk.newTitle") : ro ? t("sk.viewTitle", { name: entry.name }) : t("sk.editTitle", { name: entry.name });
  return h("main", { class: "page form-page", id: "main" },
    h("div", {}, h("a", { class: "back-link", href: "#/skills" }, icon("back", "ic sm"), t("sk.backList")), h("h1", { class: "page-title" }, title, " ",
      !isNew ? h("span", { class: `chip src-${entry.source}`, text: t(`sk.src.${entry.source}`) }) : null)),
    ro ? h("div", { class: "callout callout-info" }, icon("lock", "ic sm"), h("p", { text: t("sk.readonly") })) : null,
    summary,
    h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } }, ...fields, impact,
      ro ? null : h("div", { class: "form-actions" },
        h("button", { type: "submit", class: "btn btn-primary", disabled: isNew && d.src === "pick" && !d.pick }, t("sk.save")),
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => { S.draft = null; go("#/skills"); } }, t("sk.cancel")))));
}

// ── Persona editor (skills section; other fields elided) ──
function personaEditor(key) {
  const isNew = key === "new";
  const p = PERSONAS[key];
  if (!S.edDraft || S.edDraft.for !== key) S.edDraft = isNew ? { for: key, name: "", projects: ["billing"], skills: [] } : { for: key, name: p.name, projects: [...p.projects], skills: [...p.skills] };
  const d = S.edDraft;
  const me = S.role === "admin" ? "alice" : "bob";
  const cat = catalog().filter((e) => e.valid && allowedFor(e, me));
  const notAllowed = (e) => d.projects.filter((x) => !allowedIn(e, x));
  const toggleProject = (id, on) => {
    d.projects = on ? [...d.projects, id] : d.projects.filter((x) => x !== id);
    const removed = d.skills.filter((s) => { const e = cat.find((c) => c.name === s); return e && notAllowed(e).length; });
    if (removed.length) {
      d.skills = d.skills.filter((s) => !removed.includes(s));
      const e = cat.find((c) => c.name === removed[0]);
      S.edNote = t("ed.skillRemoved", { name: removed.join(", "), list: listNames(notAllowed(e)) });
      announce(S.edNote);
    } else S.edNote = null;
    render(); document.querySelector(`input[name="projects"][value="${id}"]`)?.focus();
  };
  let skillsField;
  if (!cat.length) {
    skillsField = isAdmin()
      ? h("div", { class: "field" }, h("span", { class: "rc-title", text: t("ed.skills") }),
          h("div", { class: "callout callout-info" }, icon("info", "ic sm"), h("p", {}, t("ed.skillsEmptyAdmin"), " ", h("a", { href: "#/skills", text: t("ed.skillsEmptyLink") }))))
      : null; // members: no field at all
  } else {
    skillsField = h("fieldset", { class: "field", "aria-describedby": "skills-hint" }, h("legend", { text: t("ed.skills") }),
      h("p", { class: "hint", id: "skills-hint", text: t("ed.skillsHint") }),
      S.edNote ? h("div", { class: "callout callout-info" }, icon("info", "ic sm"), h("p", { text: S.edNote })) : null,
      h("div", { class: "skill-opts" }, ...cat.map((e) => {
        const bad = notAllowed(e);
        const off = bad.length > 0;
        const whyId = `why-${e.name}`;
        const why = off ? t("ed.skillNotHere", { list: listNames(bad) }) : e.targets !== "*" ? t("ed.skillOnly", { list: listNames(e.targets) }) : null;
        return h("label", { class: `skill-opt${off ? " is-off" : ""}` },
          h("input", { type: "checkbox", name: "skills", value: e.name, checked: d.skills.includes(e.name), disabled: off, "aria-describedby": why ? whyId : null,
            onchange: (ev) => { d.skills = ev.target.checked ? [...d.skills, e.name] : d.skills.filter((x) => x !== e.name); S.edNote = null; } }),
          h("span", { class: "o-text" }, h("span", { class: "o-name", text: e.name }), h("span", { class: "o-desc", text: e.desc }),
            why ? h("span", { class: "o-why", id: whyId }, off ? icon("lock", "ic sm") : null, why) : null));
      })));
  }
  return h("main", { class: "page form-page", id: "main" },
    h("div", {}, h("a", { class: "back-link", href: "#/" }, icon("back", "ic sm"), t("ed.back")), h("h1", { class: "page-title", text: isNew ? t("ed.newTitle") : t("ed.title") })),
    h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); toast("Mentve."); } },
      h("div", { class: "field" }, h("label", { for: "f-pname", text: t("ed.name") }), h("input", { class: "input", id: "f-pname", value: d.name, oninput: (e) => (d.name = e.target.value) })),
      h("p", { class: "hint", text: "… (avatar, leírás, szerep, modell, eszközök — változatlan)" }),
      h("fieldset", { class: "field" }, h("legend", { text: t("ed.projects") }), h("p", { class: "hint", text: t("ed.projectsHint") }),
        h("div", { class: "check-list" }, ...PROJECTS.map((pr) => h("label", {}, h("input", { type: "checkbox", name: "projects", value: pr.id, checked: d.projects.includes(pr.id), onchange: (e) => toggleProject(pr.id, e.target.checked) }), tName(pr.id))))),
      skillsField,
      h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn btn-primary" }, t("ed.save")), h("a", { class: "btn btn-secondary", href: "#/" }, t("ed.cancel")))));
}

// ── Conversation (two states) ──
function conversation(key) {
  const p = PERSONAS[key];
  const effective = p.skills.filter((s) => catalog().some((e) => e.name === s && e.valid));
  const headEl = h("div", { class: "convo-head" }, h("a", { class: "back-link", href: "#/" }, icon("back", "ic sm"), t("cv.back")),
    h("div", { class: "convo-id" }, h("span", { class: `avatar sm t-${p.tint}`, "aria-hidden": "true", text: p.mono }), h("h1", { class: "agent-name", text: p.name })),
    h("div", { class: "convo-meta" }, ...effective.map((s) => h("span", { class: "chip skill" }, icon("spark", "ic sm"), s))));
  if (p.blocked) {
    return h("main", { class: "convo", id: "main" }, headEl,
      h("div", { class: "convo-banners" }, h("div", { class: "callout callout-error stack", role: "alert" }, icon("alert", "ic sm"),
        h("div", { class: "grow" }, h("p", {}, h("strong", { text: t("cv.blockedTitle") })), h("p", { text: t(`cv.blockedBody.${p.blocked.reason}`, { s: p.blocked.skill }) }),
          isAdmin() ? null : h("p", { text: t("cv.blockedMember") })),
        isAdmin() ? (p.blocked.reason === "invalid" ? h("button", { type: "button", class: "btn btn-secondary", onclick: () => go(`#/skills/${p.blocked.skill}`) }, icon("spark", "ic sm"), t("cv.blockedFixSkill")) : h("button", { type: "button", class: "btn btn-secondary", onclick: () => go(`#/personas/${p.key}`) }, icon("edit", "ic sm"), t("cv.blockedAdmin"))) : null)),
      h("div", { class: "transcript" }, h("div", { class: "history-divider", text: "korábbi beszélgetés" }),
        h("div", { class: "msg-user" }, h("div", { class: "bubble", text: "Nézd át a régi portál lint hibáit." })),
        h("div", { class: "msg-assistant" }, h("p", { text: "Átnéztem, 14 figyelmeztetés maradt, ebből 3 valódi hiba." }))),
      h("div", { class: "composer" }, h("div", { class: "composer-card", "aria-disabled": "true" },
        h("textarea", { rows: "1", disabled: true, "aria-label": t("cv.placeholder", { name: p.name }), placeholder: t("cv.placeholder", { name: p.name }) }),
        h("button", { type: "button", class: "btn btn-primary btn-send", disabled: true, "aria-label": t("cv.send") }, icon("send")))));
  }
  const send = () => {
    const m = /^\/skill:([a-z0-9-]+)/.exec(S.cvText.trim());
    if (m && !effective.includes(m[1])) { S.cvError = m[1]; render(); document.querySelector(".composer textarea").focus(); announce(t("cv.skillRefused", { s: m[1] })); return; }
    S.cvError = null; S.cvText = ""; toast("(sent)"); render();
  };
  return h("main", { class: "convo", id: "main" }, headEl,
    h("div", { class: "transcript" },
      h("div", { class: "msg-user" }, h("div", { class: "bubble", text: "Kérlek nézd át a számlázási modul PR-ját." })),
      h("div", { class: "msg-assistant" }, h("div", { class: "tool-step" }, h("span", { class: "tool-name", text: "read" }), h("span", { class: "tool-arg mono", text: "~/.pi/agent/skills/review/SKILL.md" }), h("span", { class: "ok" }, icon("check", "ic sm"))),
        h("p", { text: "A review képesség szerint átnéztem: 2 hiányzó teszt, 1 elnevezési javaslat." }))),
    h("div", { class: "composer" },
      S.cvError ? h("div", { class: "composer-error", id: "cv-err" }, icon("alert", "ic sm"),
        h("div", {}, h("p", { text: t("cv.skillRefused", { s: S.cvError }) }), h("p", { text: effective.length ? t("cv.skillAvail", { list: effective.map((s) => `/skill:${s}`).join(", ") }) : t("cv.skillNone") }))) : null,
      h("div", { class: "composer-card" },
        h("textarea", { rows: "2", "aria-label": t("cv.placeholder", { name: p.name }), "aria-invalid": S.cvError ? "true" : null, "aria-describedby": S.cvError ? "cv-err" : null,
          oninput: (e) => { S.cvText = e.target.value; }, onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } }, S.cvText),
        h("button", { type: "button", class: "btn btn-primary btn-send", "aria-label": t("cv.send"), onclick: send }, icon("send")))));
}

// ── Router ──
function view() {
  const r = location.hash || "#/";
  let m;
  if ((m = /^#\/skills\/(.+)$/.exec(r))) return skillForm(decodeURIComponent(m[1]));
  if (r === "#/skills") return skillsList();
  if ((m = /^#\/personas\/(.+)$/.exec(r))) return personaEditor(decodeURIComponent(m[1]));
  if ((m = /^#\/agent\/(.+)$/.exec(r))) return conversation(decodeURIComponent(m[1]));
  return grid();
}
function render() {
  const focusId = document.activeElement?.id;
  $("#app").replaceChildren(header(), view());
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
}
window.addEventListener("hashchange", () => { S.cvError = null; render(); $("#main")?.querySelector("h1")?.setAttribute("tabindex", "-1"); $("#main h1")?.focus(); $("#mScreen").value = location.hash; });
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) document.querySelectorAll(".menu").forEach((m) => (m.hidden = true)); });
$("#mScreen").onchange = (e) => go(e.target.value);
$("#mRole").onchange = (e) => { S.role = e.target.value; S.draft = null; S.edDraft = null; render(); };
$("#mMode").onchange = (e) => { S.mode = e.target.value; S.draft = null; render(); };
$("#mCatalog").onchange = (e) => { S.catalog = e.target.value; S.draft = null; S.edDraft = null; render(); };
render();
