/**
 * Lights follow the slide.
 *
 * The rail strings slides 40 units apart, but the key light's target and the
 * rim spot were left at the world origin: a `DirectionalLight`'s orthographic
 * shadow frustum is ±14 × ±10 around its target, so EVERY slide past the first
 * fell outside it and cast no shadow at all, and the rim spot (distance 40)
 * never reached them either. The lab moved all three every frame, right after
 * the floor follow that did get ported.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { frameAt, frameDiff } from "../../__tests__/helpers/frames.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";

const hasChromium = await chromiumAvailable();

/** Three slides, so slide 3 sits 80 units down the rail from the lights' origin. */
const DECK = ["---", "mode: dark", "---", "", "# One", "", "- a", "", "# Two", "", "- b", "", "# Three", "", "- c", ""].join("\n");

function deckWith(prefix: string, defaults: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "deck.md"), DECK);
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.overrides = { ...deck.overrides, deck: { ...(deck.overrides?.deck ?? {}), ...defaults } };
  writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
  expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
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

describe.skipIf(!hasChromium)("F36 lights follow the slide (chromium)", () => {
  it("keeps the key target and rim spot on the current slide, so a far slide still casts", async () => {
    const shadows = deckWith("deck3d-lights-on-", {});
    const flat = deckWith("deck3d-lights-off-", { softShadows: false });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const a = await open(browser, shadows);
      const b = await open(browser, flat);

      // Slide 3 is 80 units down the rail — far outside a frustum parked at 0.
      for (const p of [a, b]) {
        await p.page.evaluate(() => window.__deck3d!.gotoSlide(3));
        await frameAt(p.page, 1);
      }
      const look = await a.page.evaluate(() => window.__deck3d!.debug.look());
      expect(Math.abs(look.keyTarget[0] - look.camTarget[0])).toBeLessThan(0.5);
      expect(Math.abs(look.rimPos[0] - look.camTarget[0])).toBeLessThan(8);

      // …and the shadow actually lands: the lit frame must differ from the
      // same slide rendered with `softShadows: false`.
      const lit = await frameAt(a.page, 1);
      const d = await frameDiff(b.page, lit, { x: 0, y: 380, w: 1280, h: 340 });
      expect(d.differing / d.total).toBeGreaterThan(0.02);

      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
      for (const p of [a, b]) await p.page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
