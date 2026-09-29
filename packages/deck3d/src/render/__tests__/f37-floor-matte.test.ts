/**
 * `defaults.floorMatte` — how rough the reflective floor reads.
 *
 * `Reflector` only ever renders a perfect mirror; a real floor scatters the
 * reflected ray. `floorMatte` (0 = mirror, 1 = fully diffuse) drives a
 * noise-distorted, multi-tap blur of the reflection and fades it toward the
 * floor colour, and is the first deck knob rendered as a real SLIDER.
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

describe("defaults.floorMatte is schema-validated", () => {
  const base = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8"));
  it("accepts 0..1 on the deck, rejects out-of-range, and allows it per slide", () => {
    for (const floorMatte of [0, 0.5, 1]) {
      expect(validate({ ...base, defaults: { ...base.defaults, floorMatte } }).ok, String(floorMatte)).toBe(true);
    }
    const bad = validate({ ...base, defaults: { ...base.defaults, floorMatte: 1.4 } });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.errors)).toMatch(/defaults\.floorMatte/);
    // Per-slide since #F43: the runtime always applied it per slide
    // (`effective()` spreads the slide over the defaults); the schema
    // used to reject it, so the panel could export an unrenderable deck.
    expect(validate({ ...base, overrides: { slides: { [base.slides[0].id]: { floorMatte: 0.5 } } } }).ok).toBe(true);
  });
});

describe.skipIf(!hasChromium)("F37 matte floor (chromium)", () => {
  it("scatters the reflection, is deterministic, and rides a live slider", async () => {
    const mirror = deckWith("deck3d-matte-0-", {});
    const matte = deckWith("deck3d-matte-1-", { floorMatte: 0.9 });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const a = await open(browser, mirror);
      const b = await open(browser, matte);
      const again = await open(browser, matte);

      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().floorMatte)).toBe(0);
      expect(await b.page.evaluate(() => window.__deck3d!.debug.look().floorMatte)).toBeCloseTo(0.9, 5);

      // Lower third = floor. A matte floor must not match the mirror there.
      const floorRect = { x: 0, y: 480, w: 1280, h: 240 };
      const sharp = await frameAt(a.page, 1);
      await frameAt(b.page, 1);
      const d = await frameDiff(b.page, sharp, floorRect);
      expect(d.differing / d.total).toBeGreaterThan(0.05);

      // The scatter is seeded noise, not `Math.random`: same deck, same frame.
      const first = await frameAt(b.page, 1);
      await frameAt(again.page, 1);
      await expectSameFrame(again.page, first, "matte floor");

      // Live: the configurator slider reaches the frame without a reload.
      await a.page.keyboard.press("c");
      await a.page.evaluate(() => {
        for (const el of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (el as HTMLDetailsElement).open = true;
      });
      const slider = a.page.locator('#deck3d-hud input[type="range"][data-path="floorMatte"]');
      expect(await slider.count()).toBe(1);
      await slider.fill("0.6");
      await slider.dispatchEvent("input");
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().floorMatte)).toBeCloseTo(0.6, 5);

      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
      for (const p of [a, b, again]) await p.page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
