// Computed-contrast probe: every visible text element vs its effective background,
// in base dark, base light and nord dark. Fails (<4.5:1, or <3:1 for >=18.66px bold / 24px)
// are printed; disabled controls and aria-hidden glyphs are exempt (WCAG 1.4.3).
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../../..")] }));
const BASE = process.env.MOCK_URL ?? "http://localhost:4610/";
const PAGES = ["/settings/services", "/settings/services/docling", "/settings/services/neo4j-graph", "/settings/services/qdrant", "/settings/services/mermaid-renderer", "/settings/runtimes"];
(async () => {
  const b = await chromium.launch();
  let total = 0, fails = [];
  for (const theme of ["dark", "light", "nord"]) for (const hash of PAGES) {
    const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
    await p.goto(BASE + "#" + hash); await p.waitForTimeout(600);
    await p.selectOption("#mock-theme", theme); await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const cv = document.createElement("canvas").getContext("2d");
      const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; } return rgba(c); };
      const blend = (top, bot) => [0, 1, 2].map((i) => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
      const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; }
        let acc = [255, 255, 255, 1]; for (const c of stack.reverse()) acc = blend(c, acc); return acc; };
      const out = { n: 0, fails: [] };
      for (const el of document.querySelectorAll(".settings *, .scrim *")) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        if (el.closest("[aria-hidden=true]") || el.closest(":disabled") || el.closest(".sr-only")) continue;
        const cs = getComputedStyle(el); const rect = el.getBoundingClientRect(); if (!rect.width || cs.visibility === "hidden" || +cs.opacity === 0) continue;
        const fg = blend(parse(cs.color), bgOf(el)), bg = bgOf(el);
        const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
        out.n++; if (ratio < (large ? 3 : 4.5)) out.fails.push(`${ratio.toFixed(2)} ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${el.textContent.trim().slice(0, 40)}"`);
      }
      return out;
    });
    total += r.n; for (const f of r.fails) fails.push(`${theme} ${hash}: ${f}`);
    await p.close();
  }
  console.log(`checked ${total} text elements; ${fails.length} below AA`);
  console.log([...new Set(fails)].join("\n"));
  await b.close();
})();
