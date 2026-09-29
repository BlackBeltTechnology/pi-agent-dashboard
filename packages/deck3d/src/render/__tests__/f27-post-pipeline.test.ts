/**
 * Post-processing pipeline (#F27–#F31, #E51, tasks 17.x).
 *
 * Before this section only `bloom` reached the composer; every other `post`
 * card was a stub the runtime never instantiated. These tests pin the
 * contract: a listed card enables a real pass for its slide only, its params
 * reach the pass, order is canonical, and every pass renders deterministically.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { expectSameFrame, frameAt as frame, frameDiff, meanLum } from "../../__tests__/helpers/frames.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";
import { REGISTRY } from "../../fx/index.js";

const hasChromium = await chromiumAvailable();

const POST_IDS = Object.values(REGISTRY)
  .filter((e) => e.card.kind === "post")
  .map((e) => e.card.id)
  .sort();

const DIAGRAM_MD = ["# Geo", "", "```mermaid", "flowchart LR", "  A[Alpha] --> B[Beta]", "  B --> C[Gamma]", "```", "", "# Ai", "", "- two", ""].join("\n");

/** Render a two-slide deck whose slides carry the given `effects[]` lists. */
function postDeck(prefix: string, slides: Record<string, unknown[]>, markdown = "# Geo\n\n- one\n\n# Ai\n\n- two\n"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "deck.md"), markdown);
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  const over: Record<string, unknown> = {};
  for (const [id, effects] of Object.entries(slides)) over[id] = { effects };
  deck.overrides = { ...deck.overrides, slides: { ...(deck.overrides?.slides ?? {}), ...over } };
  writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
  const r = runCli(["render", "deck.json", "-o", "deck.html"], dir);
  expect(r.status, r.stderr).toBe(0);
  return join(dir, "deck.html");
}

async function open(browser: Browser, path: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(pathToFileURL(path).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__deck3d!.ready());
  return { page, errors };
}

describe.skipIf(!hasChromium)("post pipeline: listed cards drive real passes (#F27, #F28)", () => {
  it("enables a card's pass for its slide only and hands it the card params", async () => {
    const path = postDeck("deck3d-post-a-", { geo: [{ id: "film", params: { intensity: 0.8 } }] });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, path);
      const on = await page.evaluate(() => ({ active: window.__deck3d!.effects().active, post: window.__deck3d!.debug.post() }));
      expect(on.active).toContain("FilmPass");
      const film = on.post.find((p) => p.id === "film");
      expect(film).toMatchObject({ enabled: true, params: { intensity: 0.8 } });
      // Every registered post card is reported, enabled or not.
      expect(on.post.map((p) => p.id).sort()).toEqual(POST_IDS);

      await page.evaluate(() => window.__deck3d!.gotoSlide(2));
      await page.evaluate(() => window.__deck3d!.ready());
      const off = await page.evaluate(() => ({ active: window.__deck3d!.effects().active, post: window.__deck3d!.debug.post() }));
      expect(off.active).not.toContain("FilmPass");
      expect(off.post.find((p) => p.id === "film")?.enabled).toBe(false);
      expect(errors).toEqual([]);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 120_000);
});

describe.skipIf(!hasChromium)("post pipeline: canonical order (#F29)", () => {
  it("renders [pixelate, vignette] and [vignette, pixelate] byte-identically, and pixelate visibly quantises", async () => {
    const a = postDeck("deck3d-post-b1-", { geo: [{ id: "pixelate", params: { size: 12 } }, { id: "vignette" }] });
    const b = postDeck("deck3d-post-b2-", { geo: [{ id: "vignette" }, { id: "pixelate", params: { size: 12 } }] });
    const plain = postDeck("deck3d-post-b3-", { geo: [] });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const pa = await open(browser, a);
      const pb = await open(browser, b);
      const pp = await open(browser, plain);
      const [fa, fb, fp] = await Promise.all([frame(pa.page, 1), frame(pb.page, 1), frame(pp.page, 1)]);
      await expectSameFrame(pa.page, fb, "order-independence");
      // Pixelate must change the frame, not merely register.
      const dp = await frameDiff(pa.page, fp);
      expect(dp.differing / dp.total).toBeGreaterThan(0.05);
      void fa;
      const active = await pa.page.evaluate(() => window.__deck3d!.effects().active);
      const iv = active.indexOf("VignettePass");
      const ip = active.indexOf("PixelatePass");
      expect(ip).toBeGreaterThan(-1);
      expect(iv).toBeGreaterThan(ip);
      expect(pa.errors).toEqual([]);
      for (const p of [pa, pb, pp]) await p.page.close();
    } finally {
      await browser.close();
    }
  }, 180_000);
});

describe.skipIf(!hasChromium)("post pipeline: selective bloom by part (#F30)", () => {
  it("brightens diagram parts and leaves the title card alone", async () => {
    const withBloom = postDeck("deck3d-post-c1-", { geo: [{ id: "selective-bloom", params: { parts: "diagram", intensity: 2 } }] }, DIAGRAM_MD);
    const without = postDeck("deck3d-post-c2-", { geo: [] }, DIAGRAM_MD);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const on = await open(browser, withBloom);
      const off = await open(browser, without);
      const probe = await on.page.evaluate(() => window.__deck3d!.debug.post().find((p) => p.id === "selective-bloom"));
      expect(probe).toMatchObject({ enabled: true, params: { parts: "diagram", intensity: 2 } });

      await on.page.evaluate(() => window.__deck3d!.setTime(1));
      await off.page.evaluate(() => window.__deck3d!.setTime(1));
      await on.page.waitForTimeout(120);
      await off.page.waitForTimeout(120);
      const m = await on.page.evaluate(() => window.__deck3d!.measure());
      const node = m.find((r) => r.kind === "node" || r.kind === "label");
      const title = m.find((r) => r.kind === "title");
      expect(node && title).toBeTruthy();
      const nodeRect = { x: node!.rect.x, y: node!.rect.y, w: node!.rect.w, h: node!.rect.h };
      const titleRect = { x: title!.rect.x, y: title!.rect.y, w: title!.rect.w, h: title!.rect.h };
      const [nOn, nOff, tOn, tOff] = await Promise.all([
        meanLum(on.page, nodeRect),
        meanLum(off.page, nodeRect),
        meanLum(on.page, titleRect),
        meanLum(off.page, titleRect),
      ]);
      expect(nOn).toBeGreaterThan(nOff + 2);
      expect(Math.abs(tOn - tOff)).toBeLessThan(2);
      expect(on.errors).toEqual([]);
      await on.page.close();
      await off.page.close();
    } finally {
      await browser.close();
    }
  }, 180_000);
});

describe.skipIf(!hasChromium)("post pipeline: ascii mode (#F31)", () => {
  it("replaces the canvas with a character grid and keeps measure() intact", async () => {
    const path = postDeck("deck3d-post-d-", { geo: [{ id: "ascii" }] }, DIAGRAM_MD);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, path);
      await page.evaluate(() => window.__deck3d!.setTime(1));
      await page.waitForTimeout(150);
      const dom = await page.evaluate(() => {
        const el = document.querySelector(".deck3d-ascii") as HTMLElement | null;
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        return {
          present: !!el,
          chars: el?.textContent?.replace(/\s/g, "").length ?? 0,
          asciiVisible: el ? getComputedStyle(el).display !== "none" : false,
          canvasHidden: getComputedStyle(canvas).visibility === "hidden" || getComputedStyle(canvas).opacity === "0",
          measured: window.__deck3d!.measure().length,
        };
      });
      expect(dom.present).toBe(true);
      expect(dom.chars).toBeGreaterThan(500);
      expect(dom.asciiVisible).toBe(true);
      expect(dom.canvasHidden).toBe(true);
      expect(dom.measured).toBeGreaterThan(2);
      // Leaving the slide restores the canvas.
      await page.evaluate(() => window.__deck3d!.gotoSlide(2));
      await page.evaluate(() => window.__deck3d!.ready());
      const after = await page.evaluate(() => {
        const el = document.querySelector(".deck3d-ascii") as HTMLElement | null;
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        return { asciiShown: !!el && getComputedStyle(el).display !== "none", canvasShown: getComputedStyle(canvas).visibility !== "hidden" };
      });
      expect(after).toEqual({ asciiShown: false, canvasShown: true });
      expect(errors).toEqual([]);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 120_000);
});

describe.skipIf(!hasChromium)("post pipeline: every post card renders deterministically (#E51)", () => {
  it("produces identical bytes across two page loads for each card, with no console error", async () => {
    // One slide per card so a single deck covers the whole post corpus.
    const md = POST_IDS.map((id, i) => `# S${i} ${id}\n\n- ${id}\n`).join("\n");
    const slides: Record<string, unknown[]> = {};
    POST_IDS.forEach((id, i) => {
      slides[`s${i}-${id}`] = [{ id }];
    });
    const path = postDeck("deck3d-post-e-", slides, md);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const a = await open(browser, path);
      const b = await open(browser, path);
      const ids = await a.page.evaluate(() => window.__DECK.slides.map((s) => s.id));
      expect(ids.length).toBe(POST_IDS.length);
      for (let i = 0; i < POST_IDS.length; i++) {
        for (const p of [a, b]) {
          await p.page.evaluate((k) => window.__deck3d!.gotoSlide(k + 1), i);
          await p.page.evaluate(() => window.__deck3d!.ready());
        }
        const [fa, fb] = await Promise.all([frame(a.page, 2), frame(b.page, 2)]);
        if (fa !== fb) await expectSameFrame(a.page, fb, `post card ${POST_IDS[i]}`);
        const active = await a.page.evaluate(() => window.__deck3d!.debug.post().filter((p) => p.enabled).map((p) => p.id));
        expect(active, `slide ${i} should enable ${POST_IDS[i]}`).toContain(POST_IDS[i]);
      }
      expect(a.errors).toEqual([]);
      await a.page.close();
      await b.page.close();
    } finally {
      await browser.close();
    }
  }, 600_000);
});
