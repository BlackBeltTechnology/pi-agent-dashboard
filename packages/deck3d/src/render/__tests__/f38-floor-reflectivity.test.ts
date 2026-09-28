/**
 * `defaults.floorReflectivity` — HOW MUCH reflection, next to `floorMatte`'s
 * how sharp. 1 keeps the mirror the deck always had; lower values fade the
 * reflection into the floor colour, which is the knob a presenter reaches for
 * when the mirrored slide competes with the real one. `mirrorFloor: false`
 * stays the hard off switch (it also skips the reflector pass entirely).
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
import { validate } from "../../ir/validate.js";

const hasChromium = await chromiumAvailable();

function deckWith(prefix: string, defaults: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "deck.md"), "# Agents\n\nThe swarm.\n\n- one\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.overrides = {
    ...deck.overrides,
    deck: { ...(deck.overrides?.deck ?? {}), ...defaults },
    slides: { ...(deck.overrides?.slides ?? {}), [deck.slides[0].id]: { effects: [{ id: "neural-mesh" }] } },
  };
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

describe("defaults.floorReflectivity is schema-validated", () => {
  const base = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8"));
  it("accepts 0..1 on the deck, rejects out-of-range, and allows it per slide", () => {
    for (const floorReflectivity of [0, 0.4, 1]) {
      expect(validate({ ...base, defaults: { ...base.defaults, floorReflectivity } }).ok, String(floorReflectivity)).toBe(true);
    }
    const bad = validate({ ...base, defaults: { ...base.defaults, floorReflectivity: -0.2 } });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.errors)).toMatch(/defaults\.floorReflectivity/);
    // Per-slide since #F43: the runtime always applied it per slide
    // (`effective()` spreads the slide over the defaults); only the schema
    // rejected it, so the panel could export an unrenderable deck.
    expect(validate({ ...base, overrides: { slides: { [base.slides[0].id]: { floorReflectivity: 0.5 } } } }).ok).toBe(true);
  });
});

describe.skipIf(!hasChromium)("F38 floor reflectivity (chromium)", () => {
  it("fades the reflection toward the floor colour and rides a live slider", async () => {
    const full = deckWith("deck3d-refl-1-", {});
    const faint = deckWith("deck3d-refl-0-", { floorReflectivity: 0.15 });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const a = await open(browser, full);
      const b = await open(browser, faint);

      // Default stays the mirror the deck always had.
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().floorReflectivity)).toBe(1);
      expect(await b.page.evaluate(() => window.__deck3d!.debug.look().floorReflectivity)).toBeCloseTo(0.15, 5);

      const floorRect = { x: 0, y: 480, w: 1280, h: 240 };
      const mirrored = await frameAt(a.page, 1);
      await frameAt(b.page, 1);
      const d = await frameDiff(b.page, mirrored, floorRect);
      expect(d.differing / d.total).toBeGreaterThan(0.05);

      // Live: the slider reaches the frame without a reload.
      await a.page.keyboard.press("c");
      await a.page.evaluate(() => {
        for (const el of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (el as HTMLDetailsElement).open = true;
      });
      const slider = a.page.locator('#deck3d-hud input[type="range"][data-path="floorReflectivity"]');
      expect(await slider.count()).toBe(1);
      // The thumb must show what the FRAME runs at. Falling back to the
      // slider's `min` had the panel claiming 0 while the deck rendered 1.
      expect(await slider.inputValue()).toBe("1");
      await slider.fill("0.3");
      await slider.dispatchEvent("input");
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().floorReflectivity)).toBeCloseTo(0.3, 5);

      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
      for (const p of [a, b]) await p.page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
