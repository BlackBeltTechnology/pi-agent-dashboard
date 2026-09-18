import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import type { Defaults } from "../../ir/types.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { harvestDiagram } from "../../parse/harvest/index.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { ensureRuntime, fontBase64, renderDeck } from "../index.js";

const hasChromium = await chromiumAvailable();
const FIXTURE = readFileSync(new URL("../../../fixtures/harvest.md", import.meta.url), "utf8");

async function writeDeck(overrides: Defaults = {}): Promise<string> {
  const { ir } = await deriveDeckIR(parseMarkdown(FIXTURE), {
    harvest: (src, id) => harvestDiagram(src, id),
  });
  ir.defaults = { ...ir.defaults, ...overrides };
  const html = renderDeck(ir, { runtime: await ensureRuntime(), font: fontBase64() });
  const path = join(mkdtempSync(join(tmpdir(), "deck3d-rt-")), "deck.html");
  writeFileSync(path, html);
  return path;
}

async function open(browser: Browser, path: string, onRoute?: (page: Page) => Promise<void>): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  if (onRoute) await onRoute(page);
  await page.goto(new URL(`file://${path}`).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
  return { page, errors };
}

describe.skipIf(!hasChromium)("runtime (chromium)", () => {
  it("boots, measures deterministically, and logs no console error", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, await writeDeck());
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      const a = await page.evaluate(() => window.__deck3d?.measure());
      const b = await page.evaluate(() => window.__deck3d?.measure());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a?.length).toBeGreaterThan(0);
      expect(a?.every((m) => Number.isFinite(m.rect.x) && Number.isFinite(m.rect.y))).toBe(true);
      const glyphs = await page.evaluate(() => window.__deck3d?.debug.titleGlyphs());
      expect(glyphs).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("honours a 1-based hash deep-link", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const path = await writeDeck();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`${new URL(`file://${path}`).href}#2`);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__deck3d?.current())).toBe(2);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("quality tiers gate the bloom pass", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const low = await open(browser, await writeDeck({ quality: "low" }));
      const lowPasses = await low.page.evaluate(() => window.__deck3d?.effects().active);
      expect(lowPasses).not.toContain("UnrealBloomPass");
      await low.page.close();

      const high = await open(browser, await writeDeck({ quality: "high" }));
      const highPasses = await high.page.evaluate(() => window.__deck3d?.effects().active);
      expect(highPasses).toContain("UnrealBloomPass");
      await high.page.close();
    } finally {
      await browser.close();
    }
  }, 180_000);

  it("opens fully offline (all non-document requests blocked)", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, await writeDeck(), async (p) => {
        await p.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
      });
      const glyphs = await page.evaluate(() => window.__deck3d?.debug.titleGlyphs());
      expect(glyphs).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
