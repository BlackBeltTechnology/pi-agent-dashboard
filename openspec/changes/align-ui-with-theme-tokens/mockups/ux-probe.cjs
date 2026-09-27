// UX probe for align-ui-with-theme-tokens. Works on the mockup AND the live dashboard.
// Checks: axe WCAG 2.2 AA both themes; COMPUTED contrast (axe skips semi-transparent bgs) for
// every text-bearing button/pill/label; target size at 375px; horizontal overflow; console.
// Usage (repo root): NODE_PATH=$PWD/node_modules node <this> <url> <outDir> [scopeSelector]
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const [url, out, scope = "main"] = process.argv.slice(2);
const results = [];
const check = (id, ok, detail) => results.push({ id, ok: !!ok, detail });

// In-page: resolve any CSS color via canvas, composite ancestor backgrounds, WCAG ratio.
const computeContrast = (scopeSel) => {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1); };
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; } let acc = [255, 255, 255, 1]; for (const c of stack.reverse()) acc = over(c, acc); return acc; };
  const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const els = [...document.querySelectorAll(`${scopeSel} button, ${scopeSel} label, ${scopeSel} h3, ${scopeSel} h4, ${scopeSel} p, ${scopeSel} span, ${scopeSel} li, ${scopeSel} a`)]
    .filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.closest("[disabled]") && getComputedStyle(e).opacity !== "0");
  return els.map((e) => { const bg = bgOf(e); const fg = over(rgba(getComputedStyle(e).color), bg); const fs = parseFloat(getComputedStyle(e).fontSize), bold = +getComputedStyle(e).fontWeight >= 700; const large = fs >= 24 || (fs >= 18.66 && bold); const interactive = !!e.closest("button, label, a") || e.matches(".help-text, [data-help]"); return { t: e.textContent.trim().slice(0, 28), r: +ratio(fg, bg).toFixed(2), need: large ? 3 : 4.5, fs, interactive }; });
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "networkidle" });
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(200);
    const axe = await new AxeBuilder({ page }).include(scope).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    check(`A-${theme} axe violations = 0`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}×${v.nodes.length}`).join("; "));
    const cs = await page.evaluate(computeContrast, scope);
    const bad = cs.filter((c) => c.r < c.need);
    check(`C-${theme} computed contrast (${cs.length} text nodes)`, bad.length === 0, bad.slice(0, 8).map((c) => `"${c.t}" ${c.r}`).join("; "));
    const small = cs.filter((c) => c.fs < 11 || (c.interactive && c.fs < 12));
    check(`S-${theme} text ≥ 11px, interactive/help ≥ 12px`, small.length === 0, small.slice(0, 8).map((c) => `"${c.t}" ${c.fs}px`).join("; "));
    await page.screenshot({ path: `${out}/after-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  const sizes = await page.$$eval(`${scope} button`, (els) => els.filter((e) => e.offsetParent).map((e) => ({ t: (e.textContent || "").trim().slice(0, 22), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })));
  const tiny = sizes.filter((s) => s.h < 44 || s.w < 44);
  check(`T1 mobile targets ≥ 44×44 (${sizes.length} buttons)`, tiny.length === 0, tiny.slice(0, 8).map((s) => `"${s.t}" ${s.w}×${s.h}`).join("; "));
  check("T2 no horizontal overflow at 375", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  const noFocus = await page.$$eval(`${scope} button`, (els) => els.filter((e) => { e.focus(); const s = getComputedStyle(e); return s.outlineStyle === "none" && !s.boxShadow.includes("rgb"); }).length);
  check("F1 every button shows a focus indicator", noFocus === 0, `${noFocus} without outline/ring`);
  check("K1 console clean", errors.length === 0, errors.join(" | "));
  await browser.close();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}${r.detail ? "  — " + r.detail : ""}`);
  console.log(`\nSCORE ${results.filter((r) => r.ok).length}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
