/**
 * The floor horizon holds WITHOUT fog.
 *
 * The floor is one 400x400 plane and `Reflector` ignores fog, so the rig hid
 * the plane's far edge with the veil's radial alpha ramp PLUS fog blending it
 * into the background. With `fog: false` nothing blended it, and because the
 * veil is a lit `MeshStandardMaterial` (it has to be — it is the surface that
 * receives the slide's shadows) its "opaque background colour" rendered
 * brighter than the unlit background: a hard grey seam straight across the
 * frame. Both floor surfaces now fade to the background by DISTANCE, which
 * does not depend on the fog switch.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";

const hasChromium = await chromiumAvailable();

function deckWith(prefix: string, defaults: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "deck.md"), "# Horizon\n\nFlat ground.\n\n- one\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.overrides = { ...deck.overrides, deck: { ...(deck.overrides?.deck ?? {}), ...defaults } };
  writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
  expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
  return join(dir, "deck.html");
}

async function open(browser: Browser, path: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__deck3d!.ready());
  await page.evaluate(() => window.__deck3d!.setTime(2));
  return page;
}

/**
 * Largest brightness jump between adjacent scanlines, sampled in a column band
 * clear of slide content. A hard horizon reads as one big jump; a faded one
 * spreads the same total change over many rows.
 */
async function maxRowJump(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    const g = document.createElement("canvas");
    g.width = c.width;
    g.height = c.height;
    const ctx = g.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(c, 0, 0);
    const img = ctx.getImageData(0, 0, g.width, g.height).data;
    const rows: number[] = [];
    for (let y = 0; y < g.height; y++) {
      let sum = 0;
      let n = 0;
      // Right-hand band: clear of the card and the diagram on this deck.
      for (let x = Math.floor(g.width * 0.78); x < g.width; x += 4) {
        const i = (y * g.width + x) * 4;
        sum += (img[i] + img[i + 1] + img[i + 2]) / 3;
        n++;
      }
      rows.push(sum / n);
    }
    let worst = 0;
    for (let y = 1; y < rows.length; y++) worst = Math.max(worst, Math.abs(rows[y] - rows[y - 1]));
    return worst;
  });
}

describe.skipIf(!hasChromium)("F39 floor horizon without fog (chromium)", () => {
  it("has no hard seam whether fog is on or off", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const withFog = await open(browser, deckWith("deck3d-horizon-fog-", {}));
      const noFog = await open(browser, deckWith("deck3d-horizon-nofog-", { fog: false }));

      const fogged = await maxRowJump(withFog);
      const unfogged = await maxRowJump(noFog);
      // Fog on is the reference: it was always smooth. Fog off must not be
      // dramatically worse — the seam measured ~4x this bound before the fix.
      expect(unfogged, `fog on ${fogged.toFixed(1)}, fog off ${unfogged.toFixed(1)}`).toBeLessThan(10);

      for (const p of [withFog, noFog]) await p.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
