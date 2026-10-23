import { chromium, firefox, webkit } from "/Users/robson/Project/pi-agent-dashboard/node_modules/playwright/index.mjs";
for (const [name, B] of Object.entries({ chromium, firefox, webkit })) {
  const b = await B.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 700 } });
  if (name === "chromium") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const out = {};
  // (a) range from outside (#before) into the transcript: does container React onCopy fire? does a document listener fire?
  {
    const p = await ctx.newPage(); await p.goto("file:///tmp/spike-d/index.html?mode=endpoints&cap=40&n=200&h=500px"); await p.waitForSelector("[data-index]");
    await p.evaluate(() => { window.__docCopy = 0; document.addEventListener("copy", () => { window.__docCopy++; }); const r = document.createRange(); r.setStart(document.getElementById("before").firstChild, 0); const row = document.querySelector('[data-index="4"] .ftr'); r.setEnd(row.firstChild, 3); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press("Meta+c");
    out.a_outsideStart = await p.evaluate(() => ({ reactOnCopy: !!window.__reactOnCopyFired, docListener: window.__docCopy }));
    await p.evaluate(() => { window.__reactOnCopyFired = false; window.__docCopy = 0; getSelection().selectAllChildren(document.body); });
    await p.keyboard.press("Meta+c");
    out.a_bodySelectAll = await p.evaluate(() => ({ reactOnCopy: !!window.__reactOnCopyFired, docListener: window.__docCopy }));
    await p.close();
  }
  // (b) decline: put PRIOR on clipboard via a normal copy, then decline-copy (preventDefault, no setData), then paste into textarea
  {
    const p = await ctx.newPage(); await p.goto("file:///tmp/spike-d/index.html?mode=endpoints&cap=40&n=50&h=500px&decline=1"); await p.waitForSelector("[data-index]");
    await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("before")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press("Meta+c"); // native copy of BEFORE-TEXT (outside scroller → React onCopy not involved)
    await p.evaluate(() => { const r = document.createRange(); const row = document.querySelector('[data-index="1"] .hdr'); r.selectNodeContents(row); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press("Meta+c"); // declined copy inside scroller
    await p.focus("#ta"); await p.keyboard.press("Meta+v"); await p.waitForTimeout(100);
    out.b_afterDeclinePaste = JSON.stringify(await p.inputValue("#ta"));
    await p.close();
  }
  console.log(name, JSON.stringify(out));
  await b.close();
}
