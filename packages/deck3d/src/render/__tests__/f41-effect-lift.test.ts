/**
 * Per-effect `lift`: raise a background effect's box off the floor.
 *
 * Background fx boxes are centred on the slide origin, so roughly 3.4 units of
 * every one sits below the floor plane (y -2.6) and is occluded by it. That is
 * right for scenery (a plate field reads as terrain you stand in) and wrong for
 * a diffuse cloud that just gets its lower half eaten. `lift` is per-effect so
 * one slide can raise its box without touching the other 22.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";
import { expectSameFrame, frameAt, frameDiff } from "../../__tests__/helpers/frames.js";

const hasChromium = await chromiumAvailable();

function deckWithLift(lift: number | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-lift-"));
  writeFileSync(join(dir, "deck.md"), "# Lift\n\nA cloud over a floor.\n\n- one\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.slides[0].effects = [{ id: "constellation", ...(lift === undefined ? {} : { params: { lift } }) }];
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

describe("F41 effect lift schema", () => {
  it("is accepted as an ordinary effect param", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-lift-schema-"));
    writeFileSync(dir + "/deck.md", "# Lift\n\nBody.\n\n- one\n");
    expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    deck.slides[0].effects = [{ id: "constellation", params: { lift: 3.4 } }];
    writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
    const res = runCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(res.status, res.stderr).toBe(0);
  });
});

describe.skipIf(!hasChromium)("F41 effect lift (chromium)", () => {
  it("raises the effect box and is exposed to the panel", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const flat = await open(browser, deckWithLift(undefined));
      const lifted = await open(browser, deckWithLift(3.4));

      // The band ABOVE the card is where a raised cloud shows up.
      const band = { x: 0, y: 40, w: 1280, h: 200 };
      const flatFrame = await frameAt(flat, 1);
      await frameAt(lifted, 1);
      const moved = await frameDiff(lifted, flatFrame, band);
      const ratio = moved.differing / moved.total;
      expect(ratio, `lift moved ${(ratio * 100).toFixed(2)}% of the upper band`).toBeGreaterThan(0.02);

      // Default stays 0: an explicit 0 renders as the untouched deck.
      const untouched = await open(browser, deckWithLift(0));
      await frameAt(untouched, 1);
      await expectSameFrame(untouched, flatFrame, "lift 0 vs unset");

      // The panel gets a `lift` control for a corpus background effect without
      // any per-effect panel code.
      await flat.keyboard.press("c");
      await flat.evaluate(() => {
        for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
      });
      const control = flat.locator('#deck3d-hud input[data-fxparam="constellation.lift"]');
      expect(await control.count()).toBe(1);
      await control.fill("3.4");
      await control.dispatchEvent("change");
      await flat.waitForTimeout(400);
      await flat.evaluate(() => {
        (document.querySelector("#deck3d-hud") as HTMLElement).style.visibility = "hidden";
      });
      const live = await frameDiff(flat, flatFrame, band);
      expect(live.differing / live.total, "panel edit must reach the frame").toBeGreaterThan(0.02);

      for (const p of [flat, lifted, untouched]) await p.close();
    } finally {
      await browser.close();
    }
  }, 300_000);
});
