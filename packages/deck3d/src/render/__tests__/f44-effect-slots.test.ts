/**
 * Effect SLOTS in the configurator.
 *
 * The old control was one flat checklist over a 79-effect corpus with no kind
 * distinction: you could untick what the deck listed and pick from a long
 * `add effect…` dropdown, but you could not see what KIND a slot held, could
 * not step through the alternatives of a kind, and params hung off rows rather
 * than off a slot.
 *
 * A slot is one effect ref: a kind picker, a stepper over that kind's effects,
 * its declared params, and a remove. Slots are addable.
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

function deckWith(effects: Array<Record<string, unknown>>, deckEffects?: Array<Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-slots-"));
  writeFileSync(join(dir, "deck.md"), "# Slots\n\nBody.\n\n- one\n\n# Second {#two}\n\nMore.\n\n- two\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.slides[0].effects = effects;
  if (deckEffects) deck.overrides = { ...deck.overrides, effects: deckEffects };
  writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
  expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
  return join(dir, "deck.html");
}

async function openPanel(browser: Browser, path: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pathToFileURL(path).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__deck3d!.ready());
  await page.keyboard.press("c");
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
  });
  return page;
}

describe.skipIf(!hasChromium)("F44 effect slots (chromium)", () => {
  it("renders one slot per effect, carrying its kind", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await openPanel(browser, deckWith([{ id: "neural-mesh" }, { id: "bloom" }]));

      const slots = page.locator("#deck3d-hud .deck3d-hud-slot");
      expect(await slots.count(), "one slot per composed effect").toBe(2);

      // Each slot names its kind and its effect.
      const kinds = await page.locator('#deck3d-hud .deck3d-hud-slot select[data-slot-kind]').evaluateAll((n) => n.map((e) => (e as HTMLSelectElement).value));
      const ids = await page.locator('#deck3d-hud .deck3d-hud-slot select[data-slot-effect]').evaluateAll((n) => n.map((e) => (e as HTMLSelectElement).value));
      expect(kinds).toEqual(["background", "post"]);
      expect(ids).toEqual(["neural-mesh", "bloom"]);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);

  it("steps to the next/previous effect WITHIN the slot's kind", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await openPanel(browser, deckWith([{ id: "neural-mesh" }]));
      const idOf = () => page.locator('#deck3d-hud .deck3d-hud-slot select[data-slot-effect]').first().inputValue();
      const kindOf = () => page.locator('#deck3d-hud .deck3d-hud-slot select[data-slot-kind]').first().inputValue();

      const start = await idOf();
      await page.locator("#deck3d-hud .deck3d-hud-slot [data-slot-next]").first().click();
      await page.waitForTimeout(300);
      const next = await idOf();
      expect(next, "next must move to another effect").not.toBe(start);
      expect(await kindOf(), "stepping stays inside the kind").toBe("background");
      expect(await page.evaluate(() => window.__deck3d!.effects().active.length)).toBeGreaterThan(0);

      await page.locator("#deck3d-hud .deck3d-hud-slot [data-slot-prev]").first().click();
      await page.waitForTimeout(300);
      expect(await idOf(), "prev must come back").toBe(start);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);

  it("exposes the selected effect's params inside its slot", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await openPanel(browser, deckWith([{ id: "constellation" }]));
      const slot = page.locator("#deck3d-hud .deck3d-hud-slot").first();
      // `lift` is the engine-level background param; `density` is the card's.
      expect(await slot.locator('[data-fxparam="constellation.lift"]').count()).toBe(1);
      expect(await slot.locator('[data-fxparam="constellation.density"]').count()).toBe(1);

      const lift = slot.locator('[data-fxparam="constellation.lift"]');
      await lift.fill("2");
      await lift.dispatchEvent("change");
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__deck3d!.effects().active.length)).toBeGreaterThan(0);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);

  it("adds and removes slots", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await openPanel(browser, deckWith([{ id: "neural-mesh" }]));
      const slots = page.locator("#deck3d-hud .deck3d-hud-slot");
      expect(await slots.count()).toBe(1);

      await page.locator("#deck3d-hud [data-add-slot]").first().click();
      await page.waitForTimeout(400);
      expect(await slots.count(), "add must append a slot").toBe(2);

      await slots.nth(1).locator("[data-slot-remove]").click();
      await page.waitForTimeout(400);
      expect(await slots.count(), "remove must drop it again").toBe(1);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);

  it("shows deck-level effects as inherited in slide scope", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      // `applyOverrides` prepends deck effects to every slide's list.
      const page = await openPanel(browser, deckWith([{ id: "neural-mesh" }], [{ id: "bloom" }]));
      // The panel opens in DECK scope, where a deck slot is the thing you edit.
      await page.locator('#deck3d-hud [data-scope="slide"]').click();
      await page.evaluate(() => {
        for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
      });
      const inherited = page.locator("#deck3d-hud .deck3d-hud-slot[data-inherited]");
      expect(await inherited.count(), "the deck slot shows as inherited").toBe(1);
      expect(await inherited.first().locator("select[data-slot-effect]").inputValue()).toBe("bloom");
      expect(await inherited.first().locator("select[data-slot-effect]").isDisabled(), "inherited slots are read-only here").toBe(true);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
