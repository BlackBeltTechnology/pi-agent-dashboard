/**
 * The mirror floor keeps reflecting up to the horizon.
 *
 * The veil's alpha ramp used to reach opaque background at r~60 of the
 * 200-unit floor, and fog (14-36) flattened whatever was left. On a slide with
 * a bright background effect the result was three stacked bands: lit backdrop
 * above the horizon, a strip of flat background under it, then bright
 * reflections nearer the camera — read by eye as a black bar across the frame.
 * The far floor must stay a dimmed reflection, not flat background.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";

const hasChromium = await chromiumAvailable();

function plateDeck(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-horizon-bar-"));
  writeFileSync(join(dir, "deck.md"), "# Horizon\n\nPlates to the horizon.\n\n- one\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  // A bright backdrop straddling the horizon is what makes the bar visible.
  deck.slides[0].effects = [{ id: "horizon-gates" }];
  writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
  expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
  return join(dir, "deck.html");
}

describe.skipIf(!hasChromium)("F40 floor horizon bar (chromium)", () => {
  it("keeps the far floor reflecting instead of going flat background", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(plateDeck()).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d!.ready());
      await page.evaluate(() => window.__deck3d!.setTime(2));

      // Brightness of the floor just under the horizon vs the near floor, in a
      // column band clear of the card.
      const { far, near } = await page.evaluate(() => {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        const g = document.createElement("canvas");
        g.width = c.width;
        g.height = c.height;
        const ctx = g.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(c, 0, 0);
        const img = ctx.getImageData(0, 0, g.width, g.height).data;
        const band = (y0: number, y1: number) => {
          let sum = 0;
          let n = 0;
          for (let y = Math.floor(g.height * y0); y < Math.floor(g.height * y1); y += 2)
            for (let x = Math.floor(g.width * 0.8); x < g.width; x += 3) {
              const i = (y * g.width + x) * 4;
              sum += (img[i] + img[i + 1] + img[i + 2]) / 3;
              n++;
            }
          return sum / n;
        };
        // 0.50-0.56 is the floor immediately under the horizon on this deck —
        // the strip that went flat. 0.82-0.95 is the near floor, always lit.
        return { far: band(0.5, 0.56), near: band(0.82, 0.95) };
      });

      // Measured: 0.35 with the tight ramp + fogged veil, 0.90 with the fix.
      expect(far / near, `far ${far.toFixed(1)} near ${near.toFixed(1)}`).toBeGreaterThan(0.6);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
