// UX probe for the team-app mockup (project-scoped teams + conversation lists).
// axe WCAG 2.2 AA per screen × theme, reflow at 375/768/1440, 44 px targets at 375, card-menu + dialog keyboard,
// decision tables (F11), editor validation (F12, F25), project selector (F24), conversation list (F21, E43-E45),
// i18n parity (F18), conversation states (C*). Scores computed in code.
// Usage (repo root): NODE_PATH=$PWD/node_modules node openspec/changes/add-team-plugin/mockups/ux-probe.cjs <url> <outDir>
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const fs = require("fs");
const [url, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (id, ok, detail = "") => results.push({ id, ok: !!ok, detail });
// [name, hash, target]
const SCREENS = [
  ["grid", "#/", "billing"], ["grid-ws", "#/", "_ws"], ["list", "#/agent/shared:backend", "billing"],
  ["convo", "#/agent/shared:backend/c/c1", "billing"], ["stale", "#/agent/private:szovegiro/c/c8", "_ws"],
  ["archived", "#/agent/shared:backend/c/c3", "billing"], ["unassigned", "#/agent/shared:kodbiralo/c/c7", "crm"],
  ["editor", "#/personas/new", "billing"], ["signin", "#/signin", "billing"], ["unavailable", "#/signin-unavailable", "billing"], ["notadmitted", "#/not-admitted", "billing"],
];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const open = async (hash, { theme = "dark", lang = "hu", target = "billing", host = "standalone" } = {}) => {
    await page.goto(url + "/index.html" + hash);
    await page.evaluate(([th, l, tg, ho]) => { localStorage.setItem("team:theme", th); localStorage.setItem("team:lang", l); localStorage.setItem("team:target", tg); localStorage.setItem("team:host", ho); }, [theme, lang, target, host]);
    await page.reload(); await page.waitForTimeout(150);
  };
  const setMock = async (id, v) => { await page.selectOption(`#${id}`, v); await page.waitForTimeout(120); };
  const axe = async () => (await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude(".mock-bar").analyze()).violations;
  const fmt = (v) => v.map((x) => `${x.id}:${x.nodes.length}:${x.nodes[0]?.target}`).join(" | ");
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash));

  // ── A11y gate per screen × theme, plus menu / selector / dialog states ──
  for (const theme of ["dark", "light"]) {
    for (const [name, h, target] of SCREENS) {
      await open(h, { theme, target });
      const v = await axe(); check(`A11Y ${name} ${theme}`, v.length === 0, fmt(v));
    }
    await open("#/", { theme, target: "_ws" });
    await page.click('[aria-label^="További műveletek: Szövegíró (tegező)"]');
    let v = await axe(); check(`A11Y card-menu ${theme}`, v.length === 0, fmt(v));
    await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.waitForTimeout(100);
    v = await axe(); check(`A11Y dialog ${theme}`, v.length === 0, fmt(v));
    await page.keyboard.press("Escape");
    await page.click("[data-testid=target-selector]");
    v = await axe(); check(`A11Y selector-open ${theme}`, v.length === 0, fmt(v));
    await page.screenshot({ path: `${out}/state-selector-${theme}.png` });
    await page.keyboard.press("Escape");
    await open("#/agent/shared:backend/c/c1", { theme });
    await page.click("[data-testid=conv-menu]"); await page.click('[role=menuitem]:has-text("Átnevezés")'); await page.waitForTimeout(80);
    v = await axe(); check(`A11Y rename-dialog ${theme}`, v.length === 0, fmt(v));
    await page.keyboard.press("Escape");
  }

  // ── Screenshots + reflow ──
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const theme of ["dark", "light"]) for (const [name, h, target] of SCREENS.slice(0, 5).concat([SCREENS[7]])) {
      await open(h, { theme, target });
      await page.screenshot({ path: `${out}/${name}-${w}-${theme}.png`, fullPage: !["convo", "stale", "list"].includes(name) });
    }
    for (const [name, h, target] of SCREENS) {
      await open(h, { target });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(`R1 no h-scroll ${name} @${w}`, sw <= 0, `overflow ${sw}px`);
    }
  }

  // ── Targets ≥ 44 px at 375 ──
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [name, h, target] of [["grid", "#/", "billing"], ["list", "#/agent/shared:backend", "billing"], ["convo", "#/agent/shared:backend/c/c1", "billing"], ["editor", "#/personas/new", "billing"]]) {
    await open(h, { target });
    const small = await page.$$eval("#app button, #app a, #app select, #app input:not([type=radio]):not([type=checkbox]), #app [role=menuitem]", (els) =>
      els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter((b) => b.h < 44 || b.w < 44));
    check(`T1 targets ≥44 @375 ${name}`, small.length === 0, JSON.stringify(small.slice(0, 6)));
  }
  // narrow: list and conversation are separate views
  await open("#/agent/shared:backend", { target: "billing" });
  check("M1 375 list route: list only", (await page.isVisible("[data-testid=conv-list]")) && !(await page.isVisible("#prompt")));
  await open("#/agent/shared:backend/c/c1", { target: "billing" });
  check("M2 375 conversation route: chat only + back to list", (await page.isVisible("#prompt")) && !(await page.isVisible("[data-testid=conv-list]")) && (await page.isVisible(".list-back")));
  await page.setViewportSize({ width: 1280, height: 900 });
  await open("#/agent/shared:backend", { target: "billing" });
  check("M3 wide list route: both panes, newest opened", (await page.isVisible("[data-testid=conv-list]")) && (await page.isVisible("#prompt")) && (await page.textContent("[data-testid=transcript]")).includes("repository.ts"));

  // ── F11 decision table ──
  const cardInfo = async (key) => page.$eval(`[data-key="${key}"]`, (c) => ({
    talk: !!c.querySelector("[data-testid=talk]"), newConv: !!c.querySelector("[data-testid=new-conv]"), list: !!c.querySelector("[data-testid=open-list]"),
    restart: [...c.querySelectorAll("button")].some((b) => /Újraindítás|Restart/.test(b.textContent)),
    status: c.dataset.status, activity: c.querySelector("[data-testid=activity]")?.textContent || "",
  })).catch(() => null);
  const menuLabels = async (key) => {
    const btn = await page.$(`[data-key="${key}"] [aria-haspopup=menu]`); if (!btn) return [];
    await btn.click(); const labels = await page.$$eval(`[data-key="${key}"] [role=menuitem]`, (els) => els.map((e) => e.textContent.trim()));
    await page.keyboard.press("Escape"); return labels;
  };
  await open("#/", { target: "billing" });
  let m = await menuLabels("shared:backend");
  check("F11 admin shared: edit + delete + fork", m.includes("Szerkesztés") && m.includes("Persona törlése") && m.some((x) => x.startsWith("Másolat")), m.join(","));
  const ret = await cardInfo("private:tesztiro");
  check("F11 retired: no new conversation, conversations reachable", ret && ret.status === "retired" && !ret.talk && !ret.newConv && ret.list);
  check("F11 status shape+word present", (await page.$$eval("[data-key] .status", (s) => s.every((e) => e.querySelector(".shape") && e.textContent.trim().length > 0))));
  await setMock("mRole", "member");
  m = await menuLabels("shared:backend");
  check("F11 member shared: fork only", !m.includes("Szerkesztés") && !m.includes("Persona törlése") && m.some((x) => x.startsWith("Másolat")), m.join(","));
  m = await menuLabels("private:adatelemzo");
  check("F11 member own: edit + delete", m.includes("Szerkesztés") && m.includes("Persona törlése"), m.join(","));
  await setMock("mRole", "admin");
  await open("#/", { target: "_ws" });
  const full = await cardInfo("shared:rendszergazda");
  check("F11 unavailable (full, multi): no conversation", full && full.status === "unavailable" && !full.talk && !full.newConv);
  check("F11 stale: Restart to apply", (await cardInfo("private:szovegiro")).restart);
  await setMock("mMode", "single");
  check("F11 single-user: full persona available", (await cardInfo("shared:rendszergazda")).talk);
  await setMock("mMode", "multi");

  // ── K: APG card menu + dialog keyboard ──
  await open("#/", { target: "_ws" });
  const kb = '[data-key="private:szovegiro"] [aria-haspopup=menu]';
  await page.focus(kb); await page.keyboard.press("ArrowDown");
  check("K1 ArrowDown opens menu", (await page.getAttribute(kb, "aria-expanded")) === "true");
  check("K2 focus on first item", await page.evaluate(() => document.activeElement?.getAttribute("role") === "menuitem"));
  await page.keyboard.press("End");
  check("K3 End → last item", await page.evaluate(() => document.activeElement?.textContent.includes("Persona törlése")));
  await page.keyboard.press("Escape");
  check("K4 Escape closes + focus returns", await page.evaluate((s) => document.activeElement === document.querySelector(s), kb) && (await page.getAttribute(kb, "aria-expanded")) === "false");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.waitForTimeout(80);
  check("K5 dialog opens modal, focus on Cancel", await page.evaluate(() => document.getElementById("confirmDialog").open && document.activeElement.id === "dlgCancel"));
  check("K6 persona delete states conversations kept", /beszélgetések megmaradnak/.test(await page.textContent("#dlgBody")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  check("K7 Escape closes dialog, focus back to menu button", await page.evaluate((s) => !document.getElementById("confirmDialog").open && document.activeElement === document.querySelector(s), kb));

  // ── F24 project selector ──
  await open("#/", { target: "billing" });
  const keys = async () => page.$$eval("[data-key]", (e) => e.map((x) => x.dataset.key));
  let k = await keys();
  check("F24 billing grid scoped", k.includes("shared:backend") && k.includes("private:adatelemzo") && !k.includes("shared:szovegiro") && !k.includes("private:szovegiro"), k.join(","));
  await page.focus("[data-testid=target-selector]"); await page.keyboard.press("ArrowDown");
  check("F24 selector opens on checked item", await page.evaluate(() => document.activeElement?.dataset.target === "billing"));
  check("F24 unavailable project disabled", (await page.getAttribute('#m-target [data-target="archiv"]', "aria-disabled")) === "true");
  await page.click('#m-target [data-target="archiv"]', { force: true }); await page.waitForTimeout(80);
  check("F24 disabled project not selectable", (await page.$eval("[data-testid=target-selector]", (b) => b.textContent)).includes("billing-api"));
  await page.keyboard.press("Escape");
  await page.click("[data-testid=target-selector]"); await page.click('#m-target [data-target="_ws"]'); await page.waitForTimeout(150);
  k = await keys();
  check("F24 switch rescopes grid", k.includes("private:szovegiro") && !k.includes("shared:backend"), k.join(","));
  check("F24 focus kept on selector", await page.evaluate(() => document.activeElement?.id === "target-selector"));
  await page.reload(); await page.waitForTimeout(150);
  check("F24 selection remembered", (await page.$eval("[data-testid=target-selector]", (b) => b.textContent)).includes("Saját munkaterület"));
  await setMock("mProjects", "none");
  check("F24 no projects: plain label, no menu", !(await page.$("[data-testid=target-selector][aria-haspopup]")) && !!(await page.$("[data-testid=target-selector]")));
  await setMock("mProjects", "some");

  // ── F20 cards: counts, latest, new ──
  await open("#/", { target: "billing" });
  const be = await cardInfo("shared:backend");
  check("F20 card shows conversation count + latest activity", /2 beszélgetés · most/.test(be.activity), be.activity);
  await page.click('[data-key="shared:backend"] [data-testid=talk]'); await page.waitForTimeout(150);
  check("F20 primary opens latest conversation", (await hash()) === "#/agent/shared:backend/c/c1");
  await open("#/", { target: "billing" });
  await page.click('[data-key="shared:backend"] [data-testid=new-conv]'); await page.waitForTimeout(150);
  check("F20 '+' creates a conversation and starts it", /\/c\/c\d+$/.test(await hash()) && /Ügynök indítása/.test(await page.textContent("[data-testid=transcript]")));
  await page.waitForTimeout(1900);
  check("F20 new conversation ready, list count 3", !(await page.isDisabled("#prompt")) && (await page.$$("[data-testid=conv-list] li")).length === 3);
  await open("#/", { target: "crm" });
  const ua = await cardInfo("shared:kodbiralo");
  check("F20 unassigned card: unavailable, no new, list link", ua && ua.status === "unavailable" && !ua.newConv && ua.list);

  // ── F21 conversation list ──
  await open("#/agent/shared:backend/c/c1", { target: "billing" });
  await page.click('[data-conv="c2"]'); await page.waitForTimeout(1900);
  const tr2 = await page.textContent("[data-testid=transcript]");
  check("F21 second conversation has its own transcript", tr2.includes("docs/lapozas.md") && !tr2.includes("repository.ts"));
  await page.click('[data-conv="c1"]'); await page.waitForTimeout(150);
  check("F21 first conversation unchanged on return", (await page.textContent("[data-testid=transcript]")).includes("repository.ts"));
  check("F21 archived hidden from default list", !(await page.$('[data-conv="c3"]')));
  await page.click("[data-testid=toggle-archived]"); await page.waitForTimeout(100);
  check("F21 archived filter shows archived only", !!(await page.$('[data-conv="c3"]')) && !(await page.$('[data-conv="c1"]')));
  await page.click('[data-conv="c3"]'); await page.waitForTimeout(150);
  check("F21 archived conversation read-only", (await page.isDisabled("#prompt")) && /Archivált beszélgetés/.test(await page.textContent(".convo-banners")));
  await page.click('.convo-banners button:has-text("Visszaállítás")'); await page.waitForTimeout(150);
  check("F21 restore returns it to the active list", (await hash()).endsWith("/c/c3") && !(await page.isDisabled("#prompt")));
  // rename
  await page.click("[data-testid=conv-menu]"); await page.click('[role=menuitem]:has-text("Átnevezés")'); await page.waitForTimeout(80);
  check("E44 rename dialog focuses the title field", await page.evaluate(() => document.activeElement?.id === "dlgInput"));
  await page.fill("#dlgInput", "Partner tábla migráció"); await page.click("#dlgOk"); await page.waitForTimeout(100);
  check("E44 rename updates list + heading", (await page.textContent('[data-conv="c3"]')).includes("Partner tábla migráció") && (await page.textContent(".conv-heading")) === "Partner tábla migráció");
  // delete
  await page.click("[data-testid=conv-menu]"); await page.click('[role=menuitem]:has-text("Beszélgetés törlése")'); await page.waitForTimeout(80);
  check("E45 delete dialog says file kept, cannot reopen", /nem nyitható meg/.test(await page.textContent("#dlgBody")) && /megmarad/.test(await page.textContent("#dlgBody")));
  await page.click("#dlgOk"); await page.waitForTimeout(150);
  check("E45 deleted conversation gone, back on list", !(await page.$('[data-conv="c3"]')) && (await hash()) === "#/agent/shared:backend");
  // limit
  await page.check("#mLimit"); await page.waitForTimeout(100);
  check("E43 limit: new conversation disabled with reason", (await page.isDisabled("[data-testid=list-new-conv]")) && /Archiválj egyet/.test(await page.textContent("#limit-hint")));
  await open("#/", { target: "billing" }); await page.check("#mLimit"); await page.waitForTimeout(100);
  check("E43 limit: card '+' disabled", await page.isDisabled('[data-key="shared:backend"] [data-testid=new-conv]'));
  // unassigned conversation read-only
  await open("#/agent/shared:kodbiralo/c/c7", { target: "crm" });
  check("E33 unassigned conversation read-only with reason", (await page.isDisabled("#prompt")) && /nincs ehhez a projekthez rendelve/.test(await page.textContent(".convo-banners")));

  // ── F12 / F25 editor ──
  await open("#/personas/new", { target: "billing" });
  await page.fill("#f-name", "x".repeat(61)); await page.click("[data-testid=save]"); await page.waitForTimeout(600);
  check("F12 61-char name → inline error", await page.isVisible("#name-err"));
  check("F12 error summary focused", await page.evaluate(() => document.activeElement?.id === "err-summary"));
  check("F12 input aria-invalid + describedby error", (await page.getAttribute("#f-name", "aria-invalid")) === "true" && (await page.getAttribute("#f-name", "aria-describedby")).includes("name-err"));
  check("F12 nothing saved (still on editor)", (await hash()) === "#/personas/new");
  check("F12 full absent: private", !(await page.$('[data-tool="full"]')));
  await page.check('input[name=scope][value=shared]'); await page.waitForTimeout(80);
  check("F12 full absent: shared in multi-user", !(await page.$('[data-tool="full"]')));
  await setMock("mMode", "single"); await page.check('input[name=scope][value=shared]'); await page.waitForTimeout(80);
  check("F12 full offered: shared in single-user", !!(await page.$('[data-tool="full"]')));
  await setMock("mMode", "multi");
  await open("#/personas/new", { target: "billing" }); await setMock("mRole", "member");
  check("F12 member: scope fixed to own", !(await page.$("input[name=scope]")));
  await setMock("mRole", "admin");
  await page.goto(url + "/index.html#/personas/new?target=billing"); await page.waitForTimeout(150);
  const checked = await page.$$eval("input[name=projects]:checked", (e) => e.map((x) => x.value));
  check("F25 new persona from a project preselects own workspace + that project", checked.join(",") === "_ws,billing", checked.join(","));
  const opts = await page.$$eval("input[name=projects]", (e) => e.map((x) => x.value));
  check("F25 options = own workspace + available projects", opts.join(",") === "_ws,billing,crm", opts.join(","));
  for (const v of checked) await page.uncheck(`input[name=projects][value="${v}"]`);
  await page.fill("#f-name", "Teszt"); await page.click("[data-testid=save]"); await page.waitForTimeout(600);
  check("F25 no target ticked → field error, not saved", (await page.isVisible("#projects-err")) && (await hash()).startsWith("#/personas/new"));
  await page.goto(url + "/index.html#/personas/new?fork=shared:kodbiralo"); await page.waitForTimeout(150);
  check("E42 fork keeps usable projects", (await page.$$eval("input[name=projects]:checked", (e) => e.map((x) => x.value))).join(",") === "billing");

  // ── F18 i18n parity + switch without reload + state kept ──
  const parity = await page.evaluate(() => { const a = Object.keys(window.__I18N.hu).sort(), b = Object.keys(window.__I18N.en).sort(); return JSON.stringify(a) === JSON.stringify(b) ? "" : a.filter((x) => !b.includes(x)).concat(b.filter((x) => !a.includes(x))).join(","); });
  check("F18 HU/EN identical key sets", parity === "", parity);
  await open("#/personas/new");
  await page.fill("#f-name", "Megtartott név");
  await page.evaluate(() => (window.__noReload = true));
  await page.click("[data-testid=lang-en]");
  check("F18 switch to EN without reload", await page.evaluate(() => window.__noReload === true && document.documentElement.lang === "en"));
  check("F18 chrome in EN", (await page.textContent("h1.page-title")) === "New persona");
  check("F18 typed value kept across switch", (await page.inputValue("#f-name")) === "Megtartott név");
  check("F18 focus kept on toggle", await page.evaluate(() => document.activeElement?.dataset.testid === "lang-en"));
  await page.click("[data-testid=lang-hu]");
  for (const [n, h, target] of [["editor", "#/personas/new", "billing"], ["grid", "#/", "billing"], ["agent", "#/agent/shared:backend/c/c1", "billing"]]) {
    await open(h, { target });
    const c = await page.$$eval("#app button, #app a", (els) => els.filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim())).length);
    check(`F18 no icon-only control without name (${n})`, c === 0);
  }

  // ── C: conversation states ──
  await open("#/agent/shared:backend/c/c1", { target: "billing" });
  check("C1 busy → Stop replaces Send", !!(await page.$('button[aria-label="Leállítás"]')));
  await page.click('button[aria-label="Leállítás"]');
  await page.fill("#prompt", "Futtasd a teszteket."); await page.keyboard.press("Enter"); await page.waitForTimeout(100);
  check("C2 sent message appears once", (await page.$$eval(".bubble", (b) => b.filter((x) => x.textContent === "Futtasd a teszteket.").length)) === 1);
  await setMock("mConvo", "reconnect");
  check("C3 reconnect banner role=status", await page.isVisible(".callout-warning[role=status]"));
  const before = await page.$$eval(".bubble", (b) => b.length);
  await page.waitForTimeout(2800);
  check("C4 transcript unchanged after reconnect (no duplicates)", (await page.$$eval(".bubble", (b) => b.length)) === before);
  await setMock("mConvo", "spawn_timeout");
  check("C5 spawn_timeout: error + Retry, input disabled", (await page.isVisible(".callout-error")) && (await page.isDisabled("#prompt")));
  await setMock("mConvo", "resume");
  check("C6 resume announces status", /folytatása/.test(await page.textContent("[data-testid=transcript]")));
  await page.waitForTimeout(1800);
  check("C7 ready after ensure, input enabled", !(await page.isDisabled("#prompt")));
  check("C8 composer hint names the target", /billing-api/.test(await page.textContent(".composer-hint")));

  // ── H: two hosts (D16) — embedded like the OpenSpec board (content area, sidebar visible) vs standalone ──
  for (const theme of ["dark", "light"]) for (const [n, h, tg] of [["grid", "#/", "billing"], ["convo", "#/agent/shared:backend/c/c1", "billing"]]) {
    await open(h, { theme, target: tg, host: "embedded" });
    const v = await axe(); check(`H0 A11Y embedded ${n} ${theme}`, v.length === 0, fmt(v));
    await page.screenshot({ path: `${out}/embedded-${n}-1440-${theme}.png` });
  }
  await open("#/", { host: "embedded" });
  check("H1 embedded: sidebar visible + board-style top bar with the selector menu", (await page.isVisible(".dash-sidebar")) && (await page.isVisible("[data-testid=embedded-topbar] [data-testid=target-selector][aria-haspopup]")) && !(await page.$(".app-header")));
  check("H2 embedded: no app sign-in/user/language/theme controls", !(await page.$("[data-testid=lang-hu]")) && !(await page.$("[data-testid=theme-toggle]")) && !(await page.$(".user-chip")) && !(await page.$(".brand")));
  check("H2b embedded top bar: Back + Open standalone, no folder crumb", !!(await page.$("[data-testid=folder-back]")) && !!(await page.$("[data-testid=open-standalone]")) && !(await page.$(".ea-folder")) && !(await page.$("[data-testid=full-team]")));
  await page.click("[data-testid=target-selector]"); await page.click('#m-target [data-target="_ws"]'); await page.waitForTimeout(150);
  check("H3 embedded: selector rescopes grid, focus kept", (await page.$$eval("[data-key]", (e) => e.map((x) => x.dataset.key))).includes("private:szovegiro") && (await page.evaluate(() => document.activeElement?.id === "target-selector")));
  await open("#/agent/shared:backend/c/c1", { host: "embedded" });
  await page.click("[data-testid=conv-menu]");
  check("H4 embedded: conversation menu offers 'Megnyitás a dashboardon'", (await page.$$eval("[role=menuitem]", (e) => e.map((x) => x.textContent.trim()))).includes("Megnyitás a dashboardon"));
  await page.keyboard.press("Escape");
  await open("#/agent/shared:backend/c/c1", { host: "standalone" });
  await page.click("[data-testid=conv-menu]");
  check("H5 standalone: no dashboard menu item, no sidebar", !(await page.$$eval("[role=menuitem]", (e) => e.map((x) => x.textContent.trim()))).includes("Megnyitás a dashboardon") && !(await page.$(".dash-sidebar")));
  await page.keyboard.press("Escape");
  await open("#/", { host: "folder" });
  await page.click("[data-testid=global-team-entry]"); await page.waitForTimeout(150);
  check("H8 sidebar global entry 'Csapat →' opens the global team (free selector)", (await page.getAttribute("[data-testid=global-team-entry]", "aria-current")) === "page" && !!(await page.$("[data-testid=embedded-topbar] [data-testid=target-selector][aria-haspopup]")));
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [n, h] of [["grid", "#/"], ["convo", "#/agent/shared:backend/c/c1"], ["list", "#/agent/shared:backend"]]) {
    await open(h, { host: "embedded" });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`H6 embedded no h-scroll ${n} @375`, sw <= 0, `overflow ${sw}px`);
    const small = await page.$$eval("[data-testid=embedded-topbar] button, [data-testid=embedded-topbar] a", (els) =>
      els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.h < 44 || b.w < 44));
    check(`H7 embedded top bar targets ≥44 @375 ${n}`, small.length === 0, JSON.stringify(small));
    if (n === "grid") for (const theme of ["dark", "light"]) { await open(h, { host: "embedded", theme }); await page.screenshot({ path: `${out}/embedded-grid-375-${theme}.png` }); }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── FD: folder entry (D17) — dashboard folder view, slot row, folder menu, enable/settings/disable ──
  const openFolder = async (opts = {}) => { await open("#/", { host: "folder", ...opts }); await page.evaluate(() => localStorage.setItem("team:folder", "/repo/billing-api/packages/core")); await page.reload(); await page.waitForTimeout(150); };
  for (const theme of ["dark", "light"]) {
    await openFolder({ theme });
    let v = await axe(); check(`FD0 A11Y folder view ${theme}`, v.length === 0, fmt(v));
    await page.screenshot({ path: `${out}/folder-1440-${theme}.png` });
    await page.click("[data-testid=folder-menu-marketing-site]");
    v = await axe(); check(`FD0 A11Y folder menu ${theme}`, v.length === 0, fmt(v));
    await page.click('#m-fold-marketing-site [role=menuitem]:has-text("bekapcsolása")'); await page.check("input[name=dlgWho][value=sel]");
    v = await axe(); check(`FD0 A11Y enable dialog ${theme}`, v.length === 0, fmt(v));
    await page.screenshot({ path: `${out}/folder-enable-dialog-${theme}.png` });
    await page.keyboard.press("Escape");
  }
  await openFolder();
  check("FD1b folder top bar: Back · 'core › AI Csapat' · Teljes csapat · Open standalone", (await page.textContent(".ea-folder")) === "core" && !!(await page.$("[data-testid=full-team]")) && !!(await page.$("[data-testid=open-standalone]")));
  check("FD1 subfolder resolves to its project: locked selector, no menu", (await page.textContent("[data-testid=target-selector]")).includes("billing-api") && !(await page.$("[data-testid=target-selector][aria-haspopup]")));
  check("FD2 team row only on matched folders", !!(await page.$("[data-testid=team-row-core]")) && !!(await page.$("[data-testid=team-row-crm-web]")) && !(await page.$("[data-testid=team-row-marketing-site]")));
  const fmenu = async (n) => { await page.click(`[data-testid=folder-menu-${n}]`); const l = await page.$$eval(`#m-fold-${n} [role=menuitem]`, (e) => e.map((x) => x.textContent.trim())); await page.keyboard.press("Escape"); return l; };
  let fm = await fmenu("core");
  check("FD3 config project: OPEN Csapat, no settings/disable", fm.includes("Csapat") && !fm.some((x) => /beállítás|kikapcsol/.test(x)), fm.join(","));
  fm = await fmenu("crm-web");
  check("FD3 folder-enabled project: settings + disable for admin", fm.includes("Csapat beállításai…") && fm.includes("Csapat kikapcsolása"), fm.join(","));
  fm = await fmenu("marketing-site");
  check("FD3 unmatched: enable for admin", fm.includes("Csapat bekapcsolása ehhez a mappához"), fm.join(","));
  await setMock("mRole", "member");
  fm = await fmenu("marketing-site");
  check("FD4 member: unmatched folder has no team item", !fm.some((x) => /Csapat/.test(x)), fm.join(","));
  fm = await fmenu("crm-web");
  check("FD4 member: no settings/disable", fm.includes("Csapat") && !fm.some((x) => /beállítás|kikapcsol/.test(x)), fm.join(","));
  await setMock("mRole", "admin");
  await page.click("[data-testid=folder-menu-marketing-site]"); await page.click('#m-fold-marketing-site [role=menuitem]:has-text("bekapcsolása")'); await page.waitForTimeout(80);
  check("FD5 enable dialog focuses the name field", await page.evaluate(() => document.activeElement?.id === "dlgName"));
  await page.fill("#dlgName", ""); await page.click("#dlgOk");
  check("FD5 blank name: error, dialog stays open", (await page.isVisible("#dlgNameErr")) && (await page.evaluate(() => document.getElementById("confirmDialog").open && document.activeElement?.id === "dlgName")));
  await page.fill("#dlgName", "Marketing oldal"); await page.check("input[name=dlgWho][value=sel]"); await page.click("#dlgOk");
  check("FD5 selected users with none ticked: error", (await page.isVisible("#dlgUsersErr")) && (await page.evaluate(() => document.getElementById("confirmDialog").open)));
  await page.check('input[name=dlgUser][value=anna]'); await page.click("#dlgOk"); await page.waitForTimeout(200);
  check("FD6 enabled: team row appears, view locked to new project", !!(await page.$("[data-testid=team-row-marketing-site]")) && (await page.textContent("[data-testid=target-selector]")).includes("Marketing oldal"));
  check("FD7 empty project: admin can add agents", !!(await page.$("[data-testid=add-agents]")));
  await page.click("[data-testid=add-agents]"); await page.check('input[name=dlgAdd][value="shared:szovegiro"]'); await page.click("#dlgOk"); await page.waitForTimeout(150);
  check("FD7 added agent shows in the project grid", (await page.$$eval("[data-key]", (e) => e.map((x) => x.dataset.key))).includes("shared:szovegiro"));
  await page.click("[data-testid=folder-menu-crm-web]"); await page.click('#m-fold-crm-web [role=menuitem]:has-text("kikapcsolása")'); await page.waitForTimeout(80);
  check("FD8 disable dialog says conversations are kept", /megmaradnak/.test(await page.textContent("#dlgBody")));
  await page.click("#dlgOk"); await page.waitForTimeout(150);
  check("FD8 disabled: row gone, enable offered again", !(await page.$("[data-testid=team-row-crm-web]")) && (await fmenu("crm-web")).includes("Csapat bekapcsolása ehhez a mappához"));
  await page.click("[data-testid=team-row-core]"); await page.waitForTimeout(100);
  await page.click("[data-testid=full-team]"); await page.waitForTimeout(150);
  check("FD9 'Teljes csapat' opens the global team (/team) on that project", !(await page.$(".ea-folder")) && (await page.textContent("[data-testid=target-selector]")).includes("billing-api") && !!(await page.$("[data-testid=target-selector][aria-haspopup]")));
  await page.setViewportSize({ width: 375, height: 800 });
  await openFolder();
  check("FD10 folder view @375: no h-scroll, content only", (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0 && !(await page.isVisible(".dash-sidebar")));
  await page.setViewportSize({ width: 1280, height: 900 });

  check("E1 no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}${r.ok || !r.detail ? "" : "  — " + r.detail}`);
  console.log(`\nSCORE ${pass}/${results.length}`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
