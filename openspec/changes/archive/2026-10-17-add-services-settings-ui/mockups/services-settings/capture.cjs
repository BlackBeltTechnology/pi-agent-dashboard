// Capture the services mockup in key states (3 themes, desktop + mobile).
// Usage: node mock-server.mjs & node capture.cjs [shotName …]
// Output: $SHOTS (default ~/.cache/svc-shots). Prints console errors (expected:
// the 400 from the invalid-definition shot).
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../../..")] }));
const BASE = process.env.MOCK_URL ?? "http://localhost:4610/";
const OUT = process.env.SHOTS ?? path.join(os.homedir(), ".cache/svc-shots");
fs.mkdirSync(OUT, { recursive: true });

const loadOutput = async (p) => { await p.click('button:has-text("Load output")'); await p.waitForTimeout(400); };
const openAdd = async (p) => { await p.click('button:has-text("Add service")'); await p.waitForTimeout(300); };
const review = async (p) => { await p.click('.dialog button:has-text("Review")'); await p.waitForTimeout(400); };

const SHOTS = {
  "list-dark": { hash: "/settings/services" },
  "list-light": { theme: "light", hash: "/settings/services" },
  "list-mobile": { width: 390, height: 844, hash: "/settings/services" },
  "detail-docling-dark": { hash: "/settings/services/docling", act: loadOutput },
  "detail-docling-light": { theme: "light", hash: "/settings/services/docling", act: loadOutput },
  "detail-neo4j-nord": { theme: "nord", hash: "/settings/services/neo4j-graph" },
  "detail-qdrant-dark": { hash: "/settings/services/qdrant" },
  "detail-gotenberg-mobile": { width: 390, height: 844, hash: "/settings/services/gotenberg", act: loadOutput },
  "runtimes-dark": { hash: "/settings/runtimes" },
  "runtimes-light-mobile": { theme: "light", width: 390, height: 844, hash: "/settings/runtimes" },
  "add-review": { hash: "/settings/services", full: false, act: async (p) => { await openAdd(p); await review(p); } },
  "add-json-error": { hash: "/settings/services", full: false, act: async (p) => {
    await openAdd(p); await p.click("text=Paste a definition");
    await p.fill("#def-json", '{"id":"x","mode":"managed","privileged":true,"health":{"kind":"tcp","endpoint":"a"}}');
    await review(p);
  } },
  "reset-confirm": { hash: "/settings/services/mermaid-renderer", full: false, act: async (p) => { await p.click('button:has-text("Reset data")'); await p.fill("#reset-confirm", "mermaid"); } },
  "prune": { hash: "/settings/services", full: false, act: async (p) => { await p.click('button:has-text("Clean up leftovers")'); await p.waitForTimeout(400); } },
  "readonly": { hash: "/settings/services/docling", role: "observe" },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const want = process.argv.slice(2);
  for (const [name, o] of Object.entries(SHOTS)) {
    if (want.length && !want.includes(name)) continue;
    const r = await fetch(BASE + "mock/role").then((x) => x.json());
    if (r.role !== (o.role ?? "operate")) await fetch(BASE + "mock/role", { method: "POST" });
    const p = await b.newPage({ viewport: { width: o.width ?? 1280, height: o.height ?? 1100 } });
    p.on("console", (m) => ["error", "warning"].includes(m.type()) && errs.push(`${name}: ${m.text()}`));
    p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`));
    await p.goto(BASE + "#" + o.hash);
    await p.waitForTimeout(700);
    if (o.theme) await p.selectOption("#mock-theme", o.theme);
    if (o.act) await o.act(p);
    await p.waitForTimeout(300);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errs.push(`${name}: horizontal overflow ${overflow}px`);
    if (o.full !== false) await p.addStyleTag({ content: ".settings{height:auto!important}.content{overflow:visible!important}" });
    await p.screenshot({ path: path.join(OUT, name + ".png"), fullPage: o.full !== false });
    await p.close();
  }
  const r = await fetch(BASE + "mock/role").then((x) => x.json());
  if (r.role !== "operate") await fetch(BASE + "mock/role", { method: "POST" });
  console.log(`shots → ${OUT}`);
  console.log(errs.length ? errs.join("\n") : "console: clean");
  await b.close();
})();
