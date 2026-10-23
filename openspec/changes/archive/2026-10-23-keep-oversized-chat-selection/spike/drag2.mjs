import { chromium, firefox, webkit } from "/Users/robson/Project/pi-agent-dashboard/node_modules/playwright/index.mjs";
const engine = process.env.ENGINE ?? "chromium";
const browser = await ({ chromium, firefox, webkit })[engine].launch();
for (const mode of ["clear", "endpoints"]) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  await p.goto(`file:///tmp/spike-d/index.html?mode=${mode}&cap=40&n=1000&h=560px`);
  await p.waitForSelector("[data-index]");
  const box = await p.locator('[data-index="0"] .hdr').boundingBox();
  await p.mouse.move(box.x + 5, box.y + 5); await p.mouse.down();
  await p.mouse.move(box.x + 300, 500, { steps: 8 });
  const trace = [];
  for (let k = 0; k < 40; k++) {
    await p.mouse.wheel(0, 400); await p.waitForTimeout(40);
    await p.mouse.move(box.x + 300 + (k % 2), 500);
    await p.waitForTimeout(20);
    if (k % 8 === 7) trace.push(await p.evaluate(() => { const s = getSelection(); const row = n => n?.parentElement?.closest?.("[data-index]")?.getAttribute("data-index") ?? (n?.id || n?.nodeName); return `${row(s.anchorNode)}→${row(s.focusNode)} c=${s.isCollapsed}`; }));
  }
  await p.mouse.up(); await p.waitForTimeout(100);
  const st = await p.evaluate(() => ({ collapsed: getSelection().isCollapsed, mounted: document.querySelectorAll("[data-index]").length }));
  let copy = null;
  if (!st.collapsed) { await p.keyboard.press("Meta+c"); copy = await p.evaluate(() => window.__copy ?? null); }
  console.log(engine, mode, JSON.stringify({ trace, st, copy }));
  await p.close();
}
await browser.close();
