import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { defaultEffectsFor, defaultSceneFor } from "../fx/defaults.js";
import { deriveDeckIR } from "../parse/derive.js";
import { harvestDiagram } from "../parse/harvest/index.js";
import { parseMarkdown } from "../parse/markdown.js";
import { ensureRuntime, renderDeck } from "../render/index.js";
import { chromiumAvailable } from "./helpers/chromium.js";

const hasChromium = await chromiumAvailable();
const FIXTURE = readFileSync(new URL("../../fixtures/strategy-lab.md", import.meta.url), "utf8");

describe.skipIf(!hasChromium)("strategy-lab parity (9.1)", () => {
  it("builds all seven slides, snapshots them, and logs no console error", async () => {
    const { ir } = await deriveDeckIR(parseMarkdown(FIXTURE), {
      harvest: (s, id) => harvestDiagram(s, id),
      effectsForSlide: defaultEffectsFor,
      sceneForSlide: defaultSceneFor,
    });
    expect(ir.slides).toHaveLength(7);
    expect(ir.slides[4].diagram.kind).toBe("flowchart");
    expect(ir.slides[5].diagram.kind).toBe("sequence");

    const html = renderDeck(ir, { runtime: await ensureRuntime() });
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(2_621_440); // P2 budget
    const dir = mkdtempSync(join(tmpdir(), "deck3d-parity-"));
    const file = join(dir, "strategy-lab.html");
    writeFileSync(file, html);

    const browser = await chromium.launch({ channel: "chromium" });
    const errors: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      const count = await page.evaluate(() => window.__DECK.slides.length);
      expect(count).toBe(7);
      for (let i = 1; i <= count; i++) {
        await page.evaluate((n) => window.__deck3d?.gotoSlide(n), i);
        await page.evaluate(() => window.__deck3d?.setTime(0));
        const measurements = await page.evaluate(() => window.__deck3d?.measure() ?? []);
        expect(measurements.length, `slide ${i}`).toBeGreaterThan(0);
        await page.screenshot({ path: join(dir, `slide-${i}.png`) });
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
