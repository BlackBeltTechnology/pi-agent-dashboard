import { chromium } from "/Users/robson/Project/pi-agent-dashboard/node_modules/playwright/index.mjs";
const id = process.argv[2];
const b = await chromium.launch();
for (const throttle of [1, 6]) {
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(`http://localhost:8000/session/${id}`);
await p.waitForSelector('[data-testid="chat-scroll-container"] [data-index]', { timeout: 90000 });
await p.waitForTimeout(8000);
if (throttle > 1) { const cdp = await p.context().newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); }
const r = await p.evaluate(async () => {
  const el = document.querySelector('[data-testid="chat-scroll-container"]');
  const rows = () => new Set([...el.querySelectorAll("[data-row-key]")].map(e => e.dataset.rowKey));
  const total = Number([...el.querySelectorAll("[data-index]")].map(e => e.dataset.index).sort((a,b)=>b-a)[0]);
  const H = el.scrollHeight; let ms = 0, mounted = 0; const per = [];
  for (let k = 0; k < 50; k++) {
    const before = rows();
    el.scrollTop = Math.floor(((k * 7919) % 97) / 97 * (H - el.clientHeight));
    const t0 = performance.now(); el.dispatchEvent(new Event("scroll")); const dt = performance.now() - t0;
    const after = rows(); let fresh = 0; for (const x of after) if (!before.has(x)) fresh++;
    if (fresh > 0) { ms += dt; mounted += fresh; per.push(+(dt / fresh).toFixed(2)); }
    await new Promise(r => setTimeout(r, 120));
  }
  per.sort((a, b) => a - b);
  return { scrollHeight: H, maxIndexSeen: total, mountedRows: mounted, msPerRowAvg: +(ms / mounted).toFixed(2), p50: per[per.length >> 1], p90: per[Math.floor(per.length * 0.9)] };
});
console.log(`cpu ${throttle}x`, JSON.stringify(r));
await p.close();
}
await b.close();
