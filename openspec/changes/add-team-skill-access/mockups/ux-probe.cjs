// UX probe for the add-team-skill-access mockup.
// axe WCAG 2.2 AA per screen × theme, reflow 375/768/1440, 44px targets at 375, i18n parity,
// and the decision flows: editor auto-untick (D5), impact preview + confirm (D8), /skill: refusal (D10),
// validation summary, member/single-user/empty-catalog variants, keyboard row menu.
// Usage (repo root): NODE_PATH=$PWD/node_modules node openspec/changes/add-team-skill-access/mockups/ux-probe.cjs <url> <outDir>
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const fs = require("fs");
const [url, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (id, ok, detail = "") => results.push({ id, ok: !!ok, detail });
const SCREENS = [
  ["grid", "#/"], ["skills", "#/skills"], ["add", "#/skills/new"], ["edit", "#/skills/review"], ["config", "#/skills/openspec-propose"],
  ["editor", "#/personas/shared:backend"], ["editor-new", "#/personas/new"], ["chat", "#/agent/shared:backend"], ["blocked", "#/agent/shared:elemzo"],
];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const open = async (hash, { theme = "dark", role = "admin", mode = "multi", catalog = "some" } = {}) => {
    await page.goto("about:blank"); await page.goto(url + "/index.html" + hash); await page.waitForTimeout(80);
    await page.selectOption("#mRole", role); await page.selectOption("#mMode", mode); await page.selectOption("#mCatalog", catalog);
    if (theme === "light") await page.click(".app-header .btn-icon");
    const th = await page.evaluate(() => document.documentElement.dataset.theme); if (th !== theme) throw new Error(`theme ${th} != ${theme}`);
    await page.waitForTimeout(80);
  };
  const axe = async () => (await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude(".mock-bar").analyze()).violations;
  const fmt = (v) => v.map((x) => `${x.id}:${x.nodes.length}:${x.nodes[0]?.target}`).join(" | ");

  // 1. axe per screen × theme
  for (const theme of ["dark", "light"]) for (const [name, hash] of SCREENS) {
    await open(hash, { theme });
    const v = await axe(); check(`axe:${name}:${theme}`, v.length === 0, fmt(v));
    await page.screenshot({ path: `${out}/${name}-${theme}-1280.png`, fullPage: true });
  }
  // variants under axe
  for (const [label, hash, opt] of [["member-grid", "#/", { role: "member" }], ["member-editor", "#/personas/shared:backend", { role: "member" }],
    ["single-add", "#/skills/new", { mode: "single" }], ["empty-skills", "#/skills", { catalog: "empty" }], ["empty-editor", "#/personas/new", { catalog: "empty" }]]) {
    await open(hash, opt); const v = await axe(); check(`axe:${label}`, v.length === 0, fmt(v));
    await page.screenshot({ path: `${out}/${label}-dark-1280.png`, fullPage: true });
  }

  // 2. reflow + target size
  for (const w of [375, 768, 1440]) for (const [name, hash] of SCREENS) {
    await page.setViewportSize({ width: w, height: 900 }); await open(hash);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`reflow:${name}:${w}`, overflow <= 1, `overflow=${overflow}`);
    if (w === 375) {
      const small = await page.evaluate(() => [...document.querySelectorAll("#app button, #app a, #app input[type=checkbox], #app input[type=radio]")]
        .map((el) => { const target = el.closest("label") || el; const r = target.getBoundingClientRect(); return { r, d: el.outerHTML.slice(0, 60) }; })
        .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 24)).map((x) => `${Math.round(x.r.width)}x${Math.round(x.r.height)} ${x.d}`));
      check(`target44:${name}`, small.length === 0, small.slice(0, 3).join(" || "));
      await page.screenshot({ path: `${out}/${name}-dark-375.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 3. i18n parity
  const parity = await page.evaluate(() => { const a = Object.keys(I18N.hu).sort(), b = Object.keys(I18N.en).sort(); return a.filter((k) => !b.includes(k)).concat(b.filter((k) => !a.includes(k))); });
  check("i18n:parity", parity.length === 0, parity.join(","));

  // 4. Flow: editor auto-untick when adding a target where a ticked skill is not allowed (D5 strict, client prevention)
  await open("#/personas/shared:backend");
  const before = await page.isChecked('input[name=skills][value=review]');
  await page.check('input[name=projects][value=crm]'); await page.waitForTimeout(80);
  const after = await page.isChecked('input[name=skills][value=review]');
  const disabled = await page.isDisabled('input[name=skills][value=review]');
  const note = await page.locator(".skill-opts").locator("xpath=..").locator(".callout-info").count();
  const focusKept = await page.evaluate(() => document.activeElement?.value === "crm");
  check("flow:editor-untick", before && !after && disabled && note === 1, `before=${before} after=${after} disabled=${disabled} note=${note}`);
  check("flow:editor-focus-kept", focusKept);
  const why = await page.getAttribute('input[name=skills][value=review]', "aria-describedby");
  check("a11y:disabled-reason-linked", !!why && (await page.locator(`#${why}`).count()) === 1, why);
  await page.screenshot({ path: `${out}/flow-editor-untick.png`, fullPage: true });

  // 5. Flow: edit narrows targets → impact preview lists blocked personas → confirm dialog on save
  await open("#/skills/review");
  check("flow:impact-hidden-initially", (await page.locator(".impact").count()) === 0);
  await page.uncheck('input[name=targetList][value=billing]'); await page.check('input[name=targetList][value=crm]'); await page.waitForTimeout(80);
  const imp = await page.locator(".impact").innerText().catch(() => "");
  check("flow:impact-preview", /Backend fejlesztő/.test(imp) && /2 élő/.test(imp) && /saját persona/.test(imp), imp.replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: `${out}/flow-impact.png`, fullPage: true });
  await page.click("form button[type=submit]"); await page.waitForTimeout(80);
  const dlgOpen = await page.evaluate(() => document.getElementById("confirmDialog").open);
  const dlgFocus = await page.evaluate(() => document.activeElement?.id);
  check("flow:save-confirm", dlgOpen && dlgFocus === "dlgCancel", `open=${dlgOpen} focus=${dlgFocus}`);
  await page.screenshot({ path: `${out}/flow-save-confirm.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(60);
  check("flow:dialog-escape-returns-focus", await page.evaluate(() => document.activeElement?.type === "submit"));

  // 6. Flow: validation summary (empty user list + empty target list)
  await open("#/skills/review");
  await page.check('input[name=users][value=some]'); await page.waitForTimeout(40);
  await page.uncheck('input[name=targetList][value=billing]'); await page.waitForTimeout(40);
  await page.click("form button[type=submit]"); await page.waitForTimeout(80);
  const sumFocus = await page.evaluate(() => document.activeElement?.id);
  const sumItems = await page.locator("#err-summary li").count();
  check("flow:error-summary", sumFocus === "err-summary" && sumItems === 2, `focus=${sumFocus} items=${sumItems}`);

  // 7. Flow: add from picker — save disabled until a pick; taken skill disabled
  await open("#/skills/new");
  check("flow:add-save-disabled", await page.isDisabled("form button[type=submit]"));
  check("flow:add-taken-disabled", await page.isDisabled('input[name=pick][value=review]'));
  await page.check('input[name=pick][value=doc-summarizer]'); await page.waitForTimeout(60);
  check("flow:add-prefill", (await page.inputValue("#f-name")) === "doc-summarizer" && !(await page.isDisabled("form button[type=submit]")));
  await page.fill(".picker-search input", "mermaid"); await page.waitForTimeout(60);
  check("flow:add-search", (await page.locator(".pick").count()) === 1);

  // 8. Flow: /skill: refusal in composer
  await open("#/agent/shared:backend");
  await page.click(".btn-send"); await page.waitForTimeout(80);
  const err = await page.locator("#cv-err").innerText().catch(() => "");
  const inv = await page.getAttribute(".composer textarea", "aria-invalid");
  check("flow:skill-refused", /memory-x/.test(err) && /review/.test(err) && inv === "true", err.replace(/\s+/g, " "));
  await page.screenshot({ path: `${out}/flow-skill-refused.png`, fullPage: true });
  await page.fill(".composer textarea", "/skill:review nézd át"); await page.click(".btn-send"); await page.waitForTimeout(60);
  check("flow:skill-granted-sends", (await page.locator("#cv-err").count()) === 0);

  // 9. Variants: member sees no Skills entry, blocked card asks admin; empty catalog editor hidden for member
  await open("#/", { role: "member" });
  check("variant:member-no-entry", (await page.locator("[data-testid=open-skills]").count()) === 0);
  check("variant:blocked-reason-invalid", /útvonala érvénytelen/.test(await page.locator(".agent-card", { hasText: "Üzleti elemző" }).innerText()));
  check("variant:member-blocked-note", /adminisztrátornak/.test(await page.locator(".agent-card", { hasText: "Üzleti elemző" }).innerText()));
  await open("#/personas/new", { role: "member", catalog: "empty" });
  check("variant:member-empty-no-field", (await page.locator("text=Képességek").count()) === 0);
  await open("#/personas/new", { catalog: "empty" });
  check("variant:admin-empty-hint-link", (await page.locator('a[href="#/skills"]').count()) === 1);
  await open("#/skills/new", { mode: "single" });
  check("variant:single-no-users-field", (await page.locator("input[name=users]").count()) === 0);
  await open("#/skills/openspec-propose");
  check("variant:edit-no-name-input", true); await open("#/skills/review"); check("variant:edit-name-static", (await page.locator("#f-name").count()) === 0); await open("#/skills/openspec-propose");
  check("variant:config-readonly", (await page.locator("form button[type=submit]").count()) === 0 && (await page.isDisabled('input[name=where][value="*"]')));

  // 10. Keyboard: row menu opens with Enter, Arrow moves, Escape returns focus
  await open("#/skills");
  const trigger = page.locator('li[data-skill=review] [aria-haspopup=menu]');
  await trigger.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(40);
  const first = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  await page.keyboard.press("ArrowDown"); const second = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press("Escape"); const back = await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup"));
  check("kbd:row-menu", first === "menuitem" && /Eltávolítás/.test(second) && back === "menu", `${first} ${second} ${back}`);

  check("console:clean", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  for (const r of results.filter((r) => !r.ok)) console.log("FAIL", r.id, r.detail);
  console.log(`${pass}/${results.length} passed`);
})();
