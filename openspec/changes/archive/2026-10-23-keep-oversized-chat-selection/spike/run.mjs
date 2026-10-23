import { chromium, firefox, webkit } from "/Users/robson/Project/pi-agent-dashboard/node_modules/playwright/index.mjs";
const engine = process.env.ENGINE ?? "chromium";
const B = { chromium, firefox, webkit }[engine];
const url = (q) => `file:///tmp/spike-d/index.html?${q}`;
const browser = await B.launch();
const MOD = "Meta";

async function page(q, throttle = 1) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  if (throttle > 1 && engine === "chromium") {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  await p.goto(url(q));
  await p.waitForSelector("[data-index]");
  return p;
}
const state = (p) => p.evaluate(() => {
  const s = getSelection();
  const el = document.getElementById("scroller");
  return { rangeCount: s.rangeCount, collapsed: s.isCollapsed, selLen: s.toString().length,
    mounted: el.querySelectorAll("[data-index]").length, scrollTop: Math.round(el.scrollTop),
    anchorInDoc: s.anchorNode ? document.contains(s.anchorNode) : null,
    anchorRow: s.anchorNode?.parentElement?.closest?.("[data-index]")?.getAttribute("data-index") ?? null,
    focusRow: s.focusNode?.parentElement?.closest?.("[data-index]")?.getAttribute("data-index") ?? null };
});

async function drag(mode, ms) {
  const p = await page(`mode=${mode}&cap=40&n=1000&h=560px`);
  const box = await p.locator('[data-index="0"] .hdr').boundingBox();
  await p.mouse.move(box.x + 5, box.y + 5);
  await p.mouse.down();
  await p.mouse.move(box.x + 200, 400, { steps: 5 });
  await p.mouse.move(box.x + 200, 650, { steps: 5 }); // below scroller bottom (560) → autoscroll
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await p.mouse.move(box.x + 200 + ((Date.now() / 50) % 2), 650); await p.waitForTimeout(50); }
  await p.mouse.up();
  await p.waitForTimeout(100);
  const st = await state(p);
  let copy = null;
  if (!st.collapsed) { await p.keyboard.press(`${MOD}+c`); copy = await p.evaluate(() => window.__copy ?? null); }
  await p.close();
  return { st, copy };
}

async function selectAll(n, throttle, measureCopy) {
  const p = await page(`mode=endpoints&cap=40&n=${n}&measureCopy=${measureCopy}`, throttle);
  await p.mouse.wheel(0, 20000); await p.waitForTimeout(150); // read mid-transcript
  const before = await p.evaluate(() => { const el = document.getElementById("scroller"); const r = [...el.querySelectorAll("[data-index]")].find(e => e.getBoundingClientRect().bottom > 0); return { st: Math.round(el.scrollTop), row: r.dataset.index, y: Math.round(r.getBoundingClientRect().top) }; });
  await p.locator("#scroller").click({ position: { x: 300, y: 100 } });
  await p.evaluate(() => getSelection().selectAllChildren(document.getElementById("scroller"))); await p.waitForTimeout(50);
  await p.keyboard.press(`${MOD}+c`);
  const copy = await p.evaluate(() => window.__copy ?? null);
  await p.waitForTimeout(300);
  const after = await p.evaluate((row) => { const el = document.getElementById("scroller"); const r = el.querySelector(`[data-index="${row}"]`); return { st: Math.round(el.scrollTop), y: r ? Math.round(r.getBoundingClientRect().top) : null, mounted: el.querySelectorAll("[data-index]").length, collapsed: getSelection().isCollapsed }; }, before.row);
  await p.close();
  return { n, throttle, measureCopy, copy, before, after };
}

const which = process.argv[2] ?? "all";
if (which === "drag" || which === "all") {
  for (const mode of ["clear", "endpoints"]) console.log("DRAG", mode, JSON.stringify(await drag(mode, 2500)));
}
if (which === "selall" || which === "all") {
  for (const throttle of [1, 6]) for (const n of [200, 500, 1000]) for (const mc of [0, 1])
    console.log("SELALL", JSON.stringify(await selectAll(n, throttle, mc)));
}
await browser.close();
