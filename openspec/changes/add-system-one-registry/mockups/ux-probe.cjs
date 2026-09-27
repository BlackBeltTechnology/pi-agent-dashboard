// biome-ignore-all lint/correctness/noUndeclaredDependencies: mockup probe, run from the repo root where playwright + @axe-core/playwright are dev deps
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: linear scripted probe of test-plan F1–F8
// UX probe for the System-1 settings mockup: scripted flows mirroring test-plan F1–F8,
// axe (WCAG 2.2 AA) in dark + light across states, target sizes at 375 px.
// Usage (from repo root so playwright resolves): node <this> <url> <outDir>
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const [url, out] = process.argv.slice(2);
const results = [];
const check = (id, ok, detail = "") => results.push({ id, ok: !!ok, detail });

async function axe(page, label) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const v = r.violations.map((x) => `${x.id}(${x.nodes.length}): ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  check(`AXE ${label}`, v.length === 0, v.join("; "));
}
const consumer = (id) => `details.consumer[data-id="${id}"]`;

(async () => {
  const browser = await chromium.launch();
  for (const theme of ["dark", "light"]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errors = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${url}${theme === "light" ? "?theme=light" : ""}`);
    const T = (s) => `${theme} ${s}`;
    await axe(page, T("base"));

    // F3 off-machine gating + preset warning
    await page.check('input[name="preset"][value="hosted"]');
    check(T("F3 hosted+off warns"), await page.isVisible("#preset-warning .callout.warning"));
    await axe(page, T("hosted warning"));
    check(T("F1 savebar dirty"), await page.isVisible("#savebar") && (await page.textContent("#savebar-msg")).includes("Decision models"));
    await page.click("#sw-off");
    check(T("F3 on clears warning"), (await page.innerHTML("#preset-warning")).trim() === "");
    await page.click("#sw-off");
    await page.click('[data-act="to-local"]');
    check(T("F3 to-local restores"), await page.isChecked('input[name="preset"][value="local-only"]'));

    // chain keyboard: move laya up, focus follows the moved row's control
    await page.focus('[data-chain="default"][data-op="up"][data-i="1"]');
    await page.keyboard.press("Enter");
    const first = await page.textContent("#default-chain li:first-child .bk");
    const f = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check(T("chain reorder by keyboard"), first === "laya", `first=${first}`);
    check(T("focus follows moved item"), f === "Move laya up" || f === "Move laya down", `focus=${f}`);

    // F2 conflict
    await page.check("#demo-conflict");
    await page.click('[data-act="save"]');
    check(T("F2 conflict error bar"), await page.isVisible("#savebar.error") && await page.isVisible('[data-act="reload"]'));
    await axe(page, T("conflict bar"));
    await page.uncheck("#demo-conflict");

    // F4 compatibility filter on pi-warden:tool-risk (requires minContextTokens 4000)
    await page.click(`${consumer("pi-warden:tool-risk")} > summary`);
    await page.check(`${consumer("pi-warden:tool-risk")} input[value="own"]`);
    const optsDefault = await page.$$eval(`${consumer("pi-warden:tool-risk")} .chain-add option`, (o) => o.map((x) => x.value));
    check(T("F4 incompatible hidden by default"), !optsDefault.includes("laya") && !optsDefault.includes("laya-typed"), optsDefault.join(","));
    await page.check('[data-incompat="pi-warden:tool-risk"]');
    const optsShown = await page.$$eval(`${consumer("pi-warden:tool-risk")} .chain-add option`, (o) => o.map((x) => x.textContent));
    check(T("F4 toggle reveals with reason"), optsShown.some((t) => /laya \(incompatible: context/.test(t)));
    check(T("F3 jev disabled in picker while off"), await page.$eval(`${consumer("pi-warden:tool-risk")} .chain-add option[value="jev"]`, (o) => o.disabled));
    await axe(page, T("incompat shown"));

    // F7 fail-open + llm warning
    check(T("F7 llm warning"), (await page.textContent(consumer("context-manager:is_lesson"))).includes("fail-open and its chain includes a chat model"));

    // fixtures missing -> Test disabled with reason
    await page.click(`${consumer("fleet:should-escalate")} > summary`);
    check(T("fixtures missing reason"), (await page.textContent(consumer("fleet:should-escalate"))).includes("Test unavailable"));

    // F5 key entry
    const key = "tsk_live_SECRET123";
    check(T("F5 password input"), (await page.getAttribute("#key-jev", "type")) === "password");
    await page.fill("#key-jev", key);
    await page.click('[data-keyform="jev"] button[type="submit"]');
    check(T("F5 cleared + set"), (await page.inputValue("#key-jev")) === "" && (await page.textContent('[data-keyform="jev"] .key-state')).includes("set"));
    check(T("F5 key not in DOM"), !(await page.content()).includes(key));
    await page.selectOption("#demo-key", "env");
    check(T("F5 env: no overwrite control"), !(await page.$("#key-jev")) && (await page.textContent("#backend-list")).includes("from environment variable"));

    // F6 Test + enforce confirm
    const sc = consumer("system-one:selftest");
    await page.click(`${sc} > summary`);
    await page.click(`${sc} [data-run]`);
    await page.waitForSelector(`${sc} table.results`, { timeout: 8000 });
    const tbl = await page.textContent(`${sc} table.results`);
    check(T("F6 results table"), ["Accuracy", "AUC", "p50", "p90"].every((h) => tbl.includes(h)));
    await page.check(`${sc} input[value="enforce"]`);
    await page.click(`${sc} [data-savecal]`);
    const title = await page.textContent("#confirm-title"), body = await page.textContent("#confirm-body");
    check(T("F6 confirm names backend + model"), title.includes("von") && body.includes("von-1.2"));
    check(T("dialog focus on Cancel"), await page.evaluate(() => document.activeElement?.id === "confirm-cancel"));
    await axe(page, T("confirm dialog"));
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    check(T("dialog focus trapped"), await page.evaluate(() => !!document.activeElement?.closest("#confirm")));
    await page.keyboard.press("Escape");
    check(T("F6 cancel writes nothing"), !(await page.textContent(`${sc} .decl`)).includes("enforce"));
    await page.click(`${sc} [data-savecal]`);
    await page.click("#confirm-ok");
    check(T("F6 confirm writes enforce"), (await page.textContent(`${sc} .decl`)).includes("enforce"));

    // runtime states
    await page.selectOption("#demo-runtime", "uv-missing");
    check(T("uv missing: Start disabled"), await page.$eval('[aria-label="Start laya-typed"]', (b) => b.disabled));
    await axe(page, T("uv missing"));
    await page.selectOption("#demo-runtime", "windows");
    check(T("windows callout"), (await page.textContent("#runtime-callout")).includes("not supported on Windows"));

    // Add backend dialog: URL classification
    await page.click("#add-backend");
    await page.check('input[name="kind"][value="http"]');
    await page.fill("#bk-url", "https://sys1.example.com/v1/systemone");
    check(T("URL classified off-machine"), (await page.textContent("#bk-url-class")).startsWith("Off-machine"));
    await axe(page, T("add dialog"));
    await page.keyboard.press("Escape");
    check(T("console clean"), errors.length === 0, errors.join(" | "));
    if (theme === "dark") await page.screenshot({ path: `${out}/state-full-dark.png`, fullPage: true });
    else await page.screenshot({ path: `${out}/state-full-light.png`, fullPage: true });
    await page.context().close();
  }

  // Target size at 375 px (WCAG 2.5.8 ≥24; ui-contract primary ≥44)
  const m = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await m.goto(url);
  await m.click(`${consumer("system-one:selftest")} > summary`);
  const small = await m.$$eval("main button, main select, main input, main summary", (els) => els
    .filter((e) => e.offsetParent && e.type !== "radio" && e.type !== "checkbox")
    .map((e) => ({ n: e.getAttribute("aria-label") || e.textContent.trim().slice(0, 24), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
    .filter((r) => r.h < 24 || r.w < 24));
  check("375 targets ≥24px", small.length === 0, JSON.stringify(small.slice(0, 5)));
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("375 no horizontal overflow", !overflow);
  await browser.close();

  const pass = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
  console.log(`\nSCORE ${pass}/${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
