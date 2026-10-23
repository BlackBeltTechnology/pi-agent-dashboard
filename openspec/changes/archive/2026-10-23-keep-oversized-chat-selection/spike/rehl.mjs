import { chromium, firefox, webkit } from "/Users/robson/Project/pi-agent-dashboard/node_modules/playwright/index.mjs";
for (const [name, B] of Object.entries({ chromium, firefox, webkit })) {
  const b = await B.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
  await p.goto(`file:///tmp/spike-d/index.html?mode=endpoints&cap=40&n=1000&h=560px`); await p.waitForSelector("[data-index]");
  const box = await p.locator('[data-index="0"] .hdr').boundingBox();
  await p.mouse.move(box.x + 5, box.y + 5); await p.mouse.down(); await p.mouse.move(box.x + 300, 500, { steps: 8 });
  for (let k = 0; k < 40; k++) { await p.evaluate(() => { document.getElementById("scroller").scrollTop += 400; }); await p.waitForTimeout(30); await p.mouse.move(box.x + 300 + (k % 2), 500); await p.waitForTimeout(20); }
  await p.mouse.up(); await p.waitForTimeout(100);
  const r = await p.evaluate(async () => {
    const el = document.getElementById("scroller"); const sel = getSelection();
    const mid = el.querySelector('[data-index="40"]');
    el.scrollTop = 40 * 250; await new Promise(r => setTimeout(r, 200));
    const rows = [...el.querySelectorAll("[data-index]")].map(e => +e.dataset.index).filter(i => i > 5 && i < 70);
    const inSel = rows.filter(i => sel.containsNode(el.querySelector(`[data-index="${i}"]`), true));
    return { wasMountedBefore: !!mid, interiorMountedNow: rows.length, interiorInSelection: inSel.length, collapsed: sel.isCollapsed };
  });
  console.log(name, JSON.stringify(r)); await b.close();
}
