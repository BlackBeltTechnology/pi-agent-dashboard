/**
 * Backdrop reflections (`defaults.reflectBackdrop`).
 *
 * `Reflector` reflects with its OWN camera (`virtualCamera = this.camera`),
 * created as a bare `PerspectiveCamera` — so its layer mask is the content
 * layer only. Once backgrounds moved to `BACKDROP_LAYER` they silently
 * vanished from every reflection, which is the look the lab had and the
 * package lost. `reflectBackdrop` (default true) puts them back.
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

/**
 * A deck whose only styling is a background effect, so the floor is the
 * variable. `neural-mesh` on purpose: a dense backdrop puts enough reflected
 * pixels in the floor band for the assertion to mean something (the sparse
 * `swarm` moves only ~0.6% of them).
 */
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

describe("defaults.reflectBackdrop is schema-validated", () => {
  const base = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8"));
  it("accepts a boolean on the deck and allows it per slide", () => {
    for (const reflectBackdrop of [true, false]) {
      expect(validate({ ...base, defaults: { ...base.defaults, reflectBackdrop } }).ok, String(reflectBackdrop)).toBe(true);
    }
    const bad = validate({ ...base, defaults: { ...base.defaults, reflectBackdrop: "yes" } });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.errors)).toMatch(/defaults\.reflectBackdrop/);
    // Per-slide since #F43: the runtime always applied it per slide
    // (`effective()` spreads the slide over the defaults); only the schema
    // rejected it, so the panel could export an unrenderable deck.
    expect(validate({ ...base, overrides: { slides: { [base.slides[0].id]: { reflectBackdrop: false } } } }).ok).toBe(true);
  });
});

describe.skipIf(!hasChromium)("F35 backdrop reflections (chromium)", () => {
  it("reflects backdrop geometry by default and drops it when switched off", async () => {
    const on = deckWith("deck3d-reflect-on-", {});
    const off = deckWith("deck3d-reflect-off-", { reflectBackdrop: false });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const a = await open(browser, on);
      const b = await open(browser, off);
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().reflectBackdrop)).toBe(true);
      expect(await b.page.evaluate(() => window.__deck3d!.debug.look().reflectBackdrop)).toBe(false);

      // Lower third of the frame = floor. The reflected background must show
      // up there, so the two frames have to differ in the floor band.
      const floorRect = { x: 0, y: 480, w: 1280, h: 240 };
      const onFrame = await frameAt(a.page, 1);
      await frameAt(b.page, 1);
      const d = await frameDiff(b.page, onFrame, floorRect);
      expect(d.differing / d.total).toBeGreaterThan(0.02);

      // Live: the configurator toggles it without a reload.
      await a.page.keyboard.press("c");
      await a.page.evaluate(() => {
        for (const el of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (el as HTMLDetailsElement).open = true;
      });
      await a.page.setChecked('#deck3d-hud input[data-path="reflectBackdrop"]', false);
      expect(await a.page.evaluate(() => window.__deck3d!.debug.look().reflectBackdrop)).toBe(false);

      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
      for (const p of [a, b]) await p.page.close();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
