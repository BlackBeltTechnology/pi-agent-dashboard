// UX probe for the ACP mockup: keyboard walk of the APG menu button, state screenshots,
// axe (WCAG 2.2 AA) in dark + light, target-size checks at 375px.
// Usage: node ux-probe.cjs <url> <outDir>   (run from repo root so playwright resolves)
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const [url, out] = process.argv.slice(2);
const results = [];
const check = (id, ok, detail) => results.push({ id, ok: !!ok, detail });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // K1 default label reflects remembered/preselected agent
  check("K1 main label names the agent", (await page.textContent("#spawnMain")).includes("querymt"));
  // K2 keyboard open: focus trigger, ArrowDown opens and focuses the checked item
  await page.focus("#spawnMenuBtn");
  await page.keyboard.press("ArrowDown");
  check("K2 ArrowDown opens menu", (await page.getAttribute("#spawnMenuBtn", "aria-expanded")) === "true");
  check("K3 focus lands on checked item", await page.evaluate(() => document.activeElement?.dataset.agent === "qmt"));
  await page.screenshot({ path: `${out}/state-menu-open-dark.png`, clip: { x: 0, y: 60, width: 900, height: 420 } });
  // K4 Arrow navigation wraps, Enter selects, focus returns to trigger
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  check("K4 Enter selects Claude Agent", (await page.textContent("#spawnMain")).includes("Claude Agent"));
  check("K5 focus returns to trigger", await page.evaluate(() => document.activeElement?.id === "spawnMenuBtn"));
  check("K6 menu closed after select", await page.isHidden("#spawnMenu"));
  // K7 Escape closes without changing selection
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  check("K7 Escape closes, selection kept", (await page.isHidden("#spawnMenu")) && (await page.textContent("#spawnMain")).includes("Claude Agent"));
  // K8 memory survives reload (per-folder key)
  await page.reload();
  check("K8 remembered after reload", (await page.textContent("#spawnMain")).includes("Claude Agent"));
  // L1 main button stays one line (no wrap) with the longest agent name at 900px two-column layout
  check("L1 split button single line", (await page.$eval("#spawnMain", (e) => e.getBoundingClientRect().height)) <= 44);
  // L2 open menu fully inside the viewport
  await page.click("#spawnMenuBtn");
  const box = await page.$eval("#spawnMenu", (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  check("L2 menu inside viewport", box.l >= 0 && box.r <= box.w, JSON.stringify(box));
  await page.keyboard.press("Escape");
  // K9 exactly one menuitemradio checked
  check("K9 single aria-checked", (await page.$$('#spawnMenu [aria-checked="true"]')).length === 1);
  // K10 spawning feedback < 1s (status text appears synchronously)
  await page.click("#spawnMain");
  check("K10 status announced on click", /Starting Claude Agent session/.test(await page.textContent("#spawnStatus")));
  check("K11 main disabled while spawning", await page.isDisabled("#spawnMain"));
  // K12 no-agents state hides chevron + agent label
  await page.uncheck("#agentsToggle");
  check("K12 no agents: chevron hidden", await page.isHidden("#spawnMenuBtn"));
  check("K13 no agents: label is plain 'New Session'", (await page.innerText("#spawnMain")).trim() === "New Session");
  await page.screenshot({ path: `${out}/state-no-agents.png`, clip: { x: 0, y: 60, width: 900, height: 300 } });
  await page.check("#agentsToggle");
  // K14 automation editor: pi re-enables skill, ACP disables with reason
  await page.selectOption("#autoAgent", "pi");
  check("K14 pi enables Skill", !(await page.isDisabled("#kindSkill")) && (await page.isHidden("#skillWhy")));
  await page.selectOption("#autoAgent", "qmt");
  check("K15 ACP disables Skill with reason", (await page.isDisabled("#kindSkill")) && (await page.isVisible("#skillWhy")));
  // K16 card menu for ended ACP session has no Resume/Fork/Reload/Retry
  await page.click("#cardMenuBtn");
  const cardItems = await page.$$eval("#cardMenu [role=menuitem]", (els) => els.map((e) => e.textContent));
  check("K16 ended ACP menu excludes pi-only actions", !cardItems.some((t) => /resume|fork|reload|retry/i.test(t)), cardItems.join(" | "));
  await page.keyboard.press("Escape");

  // W1-W5 worktree dialog
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click("#spawnMenuBtn"); await page.click('#spawnMenu [data-agent="claude"]');
  await page.click("#worktreeBtn");
  check("W1 dialog inherits tray agent", (await page.inputValue("#wtAgent")) === "claude");
  check("W2 focus moves to dialog heading", await page.evaluate(() => document.activeElement?.id === "s7h"));
  check("W3 submit + row labels name the agent", /Claude Agent/.test(await page.textContent("#wtSubmit")) &&
    /New Claude Agent session in/.test(await page.getAttribute(".wt-spawn", "aria-label")));
  await page.click(".wt-spawn");
  check("W4 existing-row spawn uses dialog agent", /Starting Claude Agent session in \.worktrees/.test(await page.textContent("#wtStatus")));
  await page.uncheck("#agentsToggle");
  check("W5 no agents: agent field hidden, plain labels", (await page.isHidden("#wtAgent")) && (await page.textContent("#wtSubmit")) === "Create + session →");
  await page.check("#agentsToggle");
  await page.locator("#s7").screenshot({ path: `${out}/state-worktree-dialog.png` });

  // G1-G4 goal detail (folder remembers claude from W-steps)
  check("G1 goal new-session label says pi", (await page.textContent("#goalNewLabel")) === "New pi session");
  await page.click("#goalNew");
  check("G2 goal spawn announces pi, ignores folder agent", /pi session/.test(await page.textContent("#goalStatus")) && !/Claude/.test(await page.textContent("#goalStatus")));
  await page.click("#goalLinkBtn");
  check("G3 link list offers pi only + omitted line", (await page.$$eval("#goalLinkList .link-item", (e) => e.map((x) => x.textContent))).every((t) => /\(pi\)/.test(t)) && await page.isVisible("#goalOmitted"));
  await page.uncheck("#agentsToggle");
  check("G4 no agents: plain label, no omitted line", (await page.textContent("#goalNewLabel")) === "New session" && await page.isHidden("#goalOmitted"));
  await page.check("#agentsToggle");
  await page.locator("#s8").screenshot({ path: `${out}/state-goal-detail.png` });

  // A11y: axe in dark and light, menu open
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.click("#spawnMenuBtn");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    check(`A-${theme} axe WCAG 2.2 AA violations = 0`, axe.violations.length === 0,
      axe.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target}`).join("; "));
    await page.screenshot({ path: `${out}/state-full-${theme}.png`, fullPage: true });
    await page.keyboard.press("Escape");
  }

  // Target size at 375px (WCAG 2.5.8 ≥24, primary ≥44)
  await page.setViewportSize({ width: 375, height: 800 });
  const sizes = await page.$$eval("#spawnMain, #spawnMenuBtn, .kebab, .btn-primary, .btn-secondary, .seg-btn, #wtAgent, .link-item", (els) =>
    els.filter((e) => e.offsetParent).map((e) => ({ id: e.id || e.className, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })));
  const small = sizes.filter((s) => s.h < 44 || s.w < 44);
  check("T1 mobile targets ≥ 44×44", small.length === 0, small.map((s) => `${s.id} ${Math.round(s.w)}×${Math.round(s.h)}`).join("; "));
  await page.click("#spawnMenuBtn");
  const mb = await page.$eval("#spawnMenu", (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  check("L3 menu inside viewport at 375", mb.l >= 0 && mb.r <= mb.w, JSON.stringify(mb));
  await page.screenshot({ path: `${out}/state-menu-open-375.png`, clip: { x: 0, y: 0, width: 375, height: 520 } });
  await page.keyboard.press("Escape");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("T2 no horizontal overflow at 375", !overflow);
  check("C1 console clean", errors.length === 0, errors.join(" | "));

  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}${r.detail ? "  — " + r.detail : ""}`);
  console.log(`\nSCORE ${pass}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
