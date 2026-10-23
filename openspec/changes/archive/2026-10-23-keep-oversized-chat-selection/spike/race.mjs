import { firefox, chromium, webkit } from "/Users/robson/Project/pi-agent-dashboard/node_modules/playwright/index.mjs";
const E = process.env.ENGINE ?? "firefox"; const b = await ({firefox,chromium,webkit})[E].launch();
for (const q of ["noSel=1", "noSel=1&live=1", "live=1"]) { const mode = "endpoints&" + q;
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
await p.goto(`file:///tmp/spike-d/index.html?mode=${mode}&cap=40&n=1000&h=560px`);
await p.waitForSelector("[data-index]");
const sel = () => p.evaluate(() => { const s = getSelection(); const row = n => n?.parentElement?.closest?.("[data-index]")?.getAttribute("data-index") ?? (n?.id || n?.nodeName); return `${row(s.anchorNode)}→${row(s.focusNode)} c=${s.isCollapsed} st=${Math.round(document.getElementById("scroller").scrollTop)}`; });
const box = await p.locator('[data-index="0"] .hdr').boundingBox();
await p.mouse.move(box.x + 5, box.y + 5); await p.mouse.down();
await p.mouse.move(box.x + 300, 500, { steps: 8 });
const tr = [await sel()];
// Firefox: drive scroll via scrollTop (wheel is swallowed during a drag), keep moving pointer to extend
for (let k = 0; k < 40; k++) {
  await p.evaluate(() => { document.getElementById("scroller").scrollTop += 400; });
  await p.waitForTimeout(30);
  await p.mouse.move(box.x + 300 + (k % 2), 500); await p.waitForTimeout(20);
  if (k % 8 === 7) tr.push(await sel());
}
await p.mouse.up(); await p.waitForTimeout(100);
const st = await p.evaluate(() => ({ collapsed: getSelection().isCollapsed, len: getSelection().toString().length }));
let copy = null;
if (!st.collapsed) { await p.keyboard.press("Meta+c"); copy = await p.evaluate(() => window.__copy ?? null); }
console.log(E, q, JSON.stringify({ tr, st, copy }).slice(0, 700));
await p.close();
}
await b.close();
