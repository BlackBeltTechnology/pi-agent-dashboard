// @ts-check
// Headless runs of a scripted frame against a RUNNING mock site:
//   mock-check <ref> [--loops N] [--url U]   N loops (default 3), exit 1 on any failed loop
//   mock-video <ref> [--out F] [--url U]     record one loop to .webm (default: project build cache)
// The pane page (`?pane=<id>/<frame>/<side>&mkLoops=N`) runs the script and
// publishes `window.__mkHealth = { completed, failed, errors }`.
// See change: add-mock-site-exact-env (design D4, D7).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchChromium } from "./browser.mjs";
import { GENERATED_DIR } from "./env.mjs";
import { parseRef } from "./refs.mjs";

export const DEFAULT_LOOPS = 3;
const DEFAULT_URL = "http://localhost:5299";
const STEP_BUDGET_MS = 60_000;

/**
 * @param {string[]} argv
 * @returns {{ ok: true, ref: string, loops: number, url: string, out?: string } | { ok: false, error: string }}
 */
function parseArgs(argv) {
  /** @type {string[]} */
  const pos = [];
  let loops = DEFAULT_LOOPS, url = DEFAULT_URL, out;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--loops") { loops = Number(argv[++i]); if (!Number.isInteger(loops) || loops < 1) return { ok: false, error: "--loops must be a positive integer" }; }
    else if (a === "--url") url = String(argv[++i] ?? "").replace(/\/+$/, "");
    else if (a === "--out") out = argv[++i];
    else pos.push(a);
  }
  if (!pos[0]) return { ok: false, error: "missing <ref> (#<id>/<frame>[/<side>])" };
  return { ok: true, ref: pos[0], loops, url, ...(out ? { out } : {}) };
}

/** `<id>/<frame>/<side>` of a frame ref (side defaults to proposed). @param {string} ref */
function paneSpec(ref) {
  const r = parseRef(ref);
  if (!r.frame) throw new Error(`ref needs a frame: ${ref} (want #<id>/<frame>[/<side>])`);
  return `${r.id}/${r.frame}/${r.side ?? "proposed"}`;
}

/** @param {{ completed: number, failed: number, errors?: string[] }} h */
const summary = (h) => [`completed ${h.completed}, failed ${h.failed}`, ...(h.errors ?? []).map((e) => `  ${e}`)].join("\n");

/** Default video file: the project's build cache, never a mock dir. @param {string} root @param {string} spec @param {string} [out] */
export function videoPath(root, spec, out) {
  if (out) return path.resolve(out);
  return path.join(root, GENERATED_DIR, "videos", `${spec.replace(/\//g, "-")}.webm`);
}

/** @param {string} url */
async function assertSite(url) {
  const r = await fetch(`${url}/__mock/decisions`).then((x) => x.json()).catch(() => null);
  if (!r?.mockSite) throw new Error(`no mock site at ${url}; start it (serve_mock_site, or npm run mocks) or pass --url`);
}

/** @param {any} page @param {number} loops */
async function waitHealth(page, loops) {
  const deadline = Date.now() + STEP_BUDGET_MS * loops;
  for (;;) {
    const h = await page.evaluate(() => /** @type {any} */ (window).__mkHealth ?? null);
    if (h?.error) return { completed: 0, failed: loops, errors: [h.error] };
    if (h && h.completed + h.failed >= loops) return h;
    if (Date.now() > deadline) return { completed: h?.completed ?? 0, failed: loops - (h?.completed ?? 0), errors: [...(h?.errors ?? []), "timed out"] };
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function chromium() {
  const spec = "playwright";
  const pw = await import(spec).catch(() => null);
  if (!pw?.chromium) throw new Error("playwright not installed: npm i -D playwright && npx playwright install chromium");
  return pw.chromium;
}

/**
 * @param {{ spec: string, loops: number, url: string }} o
 * @param {{ open?: (url: string) => Promise<{ health: any, close: () => Promise<void> }> }} [deps]
 */
async function runCheck(o, deps = {}) {
  const target = `${o.url}/?pane=${encodeURIComponent(o.spec)}&mkLoops=${o.loops}&mkFast=1`;
  if (deps.open) { const r = await deps.open(target); await r.close(); return r.health; }
  await assertSite(o.url);
  const { browser } = await launchChromium(await chromium());
  try {
    const page = await browser.newPage();
    await page.goto(target);
    return await waitHealth(page, o.loops);
  } finally {
    await browser.close();
  }
}

/** @param {{ spec: string, url: string, out: string }} o */
async function runVideo(o) {
  await assertSite(o.url);
  const { browser } = await launchChromium(await chromium());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-video-"));
  try {
    const ctx = await browser.newContext({ recordVideo: { dir } });
    const page = await ctx.newPage();
    await page.goto(`${o.url}/?pane=${encodeURIComponent(o.spec)}&mkLoops=1`);
    const h = await waitHealth(page, 1);
    await page.close();
    fs.mkdirSync(path.dirname(o.out), { recursive: true });
    await page.video()?.saveAs(o.out);
    await ctx.close();
    return h;
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {"check"|"video"} kind @param {string[]} argv @param {string} cwd
 * @param {{ open?: (url: string) => Promise<{ health: any, close: () => Promise<void> }> }} [deps]
 * @returns {Promise<{ code: number, out: string }>}
 */
export async function main(kind, argv, cwd = process.cwd(), deps = {}) {
  const a = parseArgs(argv);
  const usage = kind === "check" ? "usage: mock-check <ref> [--loops N] [--url U]" : "usage: mock-video <ref> [--out file.webm] [--url U]";
  if (!a.ok) return { code: 2, out: `${a.error}\n${usage}` };
  let spec;
  try { spec = paneSpec(a.ref); } catch (e) { return { code: 2, out: String(/** @type {Error} */ (e).message) }; }
  try {
    if (kind === "check") {
      const h = await runCheck({ spec, loops: a.loops, url: a.url }, deps);
      return { code: h.failed > 0 ? 1 : 0, out: `${spec}: ${summary(h)}` };
    }
    const { findProjectRoot } = await import("./cli.mjs");
    const out = videoPath(findProjectRoot(cwd), spec, a.out && path.resolve(cwd, a.out));
    const h = await runVideo({ spec, url: a.url, out });
    return { code: h.failed > 0 ? 1 : 0, out: `${h.failed > 0 ? "loop failed" : "video"}: ${out}\n${summary(h)}` };
  } catch (e) {
    return { code: 1, out: String(/** @type {Error} */ (e).message).split("\n")[0] };
  }
}
