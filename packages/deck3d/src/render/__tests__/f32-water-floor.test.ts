/**
 * Water floor (#E55, #F32 — Section 19). `defaults.floor: "water"` swaps the
 * reflective plane for the three `shaders_ocean` surface, driven by the
 * deterministic deck clock and tinted from the palette.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { expectSameFrame, frameAt, frameDiff } from "../../__tests__/helpers/frames.js";
import { runCli } from "../../__tests__/helpers/local-fx.js";
import { validate } from "../../ir/validate.js";

const hasChromium = await chromiumAvailable();

function deckWith(prefix: string, defaults: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "deck.md"), "# Geo\n\n- one\n\n# Ai\n\n- two\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.overrides = { ...deck.overrides, deck: { ...(deck.overrides?.deck ?? {}), ...defaults } };
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

describe("E55 defaults.floor is schema-validated", () => {
  const base = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8"));
  it("accepts mirror and water on the deck, rejects anything else, and stays deck-scope", () => {
    for (const floor of ["mirror", "water"]) {
      expect(validate({ ...base, defaults: { ...base.defaults, floor } }).ok, floor).toBe(true);
    }
    const bad = validate({ ...base, defaults: { ...base.defaults, floor: "lava" } });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.errors)).toMatch(/defaults\.floor/);
    // One global floor: like `mirrorFloor`, not a per-slide knob.
    const slide = { ...base, overrides: { slides: { [base.slides[0].id]: { floor: "water" } } } };
    expect(validate(slide).ok).toBe(false);
  });
});

describe.skipIf(!hasChromium)("F32 water floor (chromium)", () => {
  it("renders an animated, deterministic water surface and reports it in debug.look()", async () => {
    const water = deckWith("deck3d-water-", { floor: "water" });
    const mirror = deckWith("deck3d-mirror-", { floor: "mirror" });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const a = await open(browser, water);
      const b = await open(browser, water);
      const m = await open(browser, mirror);
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().floor)).toBe("water");
      expect(await m.page.evaluate(() => window.__deck3d!.debug.look().floor)).toBe("mirror");

      // Lower third of the frame = floor. Water must differ from the mirror there.
      const floorRect = { x: 0, y: 480, w: 1280, h: 240 };
      const w1 = await frameAt(a.page, 1);
      const dm = await frameDiff(m.page, w1, floorRect);
      expect(dm.differing / dm.total).toBeGreaterThan(0.2);

      // …and must move with the deck clock, not wall time.
      await frameAt(a.page, 3);
      const dt = await frameDiff(a.page, w1, floorRect);
      expect(dt.differing / dt.total).toBeGreaterThan(0.05);

      // Deterministic across page loads at the same t.
      const b1 = await frameAt(b.page, 1);
      await frameAt(a.page, 1);
      await expectSameFrame(a.page, b1, "water floor");

      // Live: the configurator's floor select switches it without a reload.
      await a.page.keyboard.press("c");
      await a.page.evaluate(() => {
        for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
      });
      await a.page.selectOption('#deck3d-hud select[data-path="floor"]', "mirror");
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().floor)).toBe("mirror");
      expect(a.errors).toEqual([]);
      for (const p of [a, b, m]) await p.page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
