/**
 * `deck3d compare` — change deck3d-pptx-import, test-plan #E54–#E57.
 * Exemplar: `src/check/__tests__/check.test.ts`.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { buildLayerDeck, openDeck, settle } from "../../__tests__/helpers/layer-deck.js";
import { encodePng, type RgbaImage } from "../../art/png.js";
import { run } from "../../cli.js";
import { scoreFrame, ssim } from "../ssim.js";

const hasChromium = await chromiumAvailable();

async function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { stdout: (l) => out.push(l), stderr: (l) => err.push(l) });
  return { code, out: out.join("\n"), stderr: err.join("\n") };
}

function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...fn(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

/** A detailed pattern (diagonal gradient + stripes) so SSIM has structure to compare. */
const pattern = (x: number, y: number): [number, number, number] => [(x * 255) / 1440, (y * 255) / 1080, ((x >> 4) + (y >> 4)) % 2 ? 220 : 40];

describe("compare scoring (no browser)", () => {
  it("scores only the slide frame: changed bars do not move the score (E56)", () => {
    const frame = img(1440, 1080, pattern);
    const withBars = (bar: [number, number, number]) => img(1920, 1080, (x, y) => (x >= 240 && x < 1680 ? pattern(x - 240, y) : bar));
    const a = scoreFrame(withBars([0, 0, 0]), frame, 1440 / 1080);
    const b = scoreFrame(withBars([255, 0, 255]), frame, 1440 / 1080);
    expect(a.score).toBeGreaterThanOrEqual(0.99);
    expect(b).toEqual(a);
  });

  it("is 1 for identical images and low for unrelated ones", () => {
    const a = img(96, 96, pattern);
    expect(ssim(a, a)).toBe(1);
    const noise = img(96, 96, (x, y) => ((x * 7 + y * 13) % 3 === 0 ? [250, 250, 250] : [5, 5, 5]));
    expect(ssim(a, noise)).toBeLessThan(0.3);
  });
});

describe.skipIf(!hasChromium)("compare (chromium)", () => {
  async function refDeck(slideIds = ["s01", "s02", "s03"]) {
    const deck = await buildLayerDeck({ slides: slideIds.map((id) => ({ id, title: `Slide ${id}` })) });
    const refs = join(deck.dir, "pptx", "ref");
    mkdirSync(refs, { recursive: true });
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await openDeck(browser, deck.html);
      for (let i = 0; i < slideIds.length; i++) {
        await settle(page, i + 1);
        await page.waitForTimeout(150);
        writeFileSync(join(refs, `${slideIds[i]}.png`), await page.screenshot());
      }
      await page.close();
    } finally {
      await browser.close();
    }
    return { deck, refs };
  }

  it("scores >= 0.99 when the references are snapshots of the same deck (E54)", async () => {
    const { deck } = await refDeck();
    const r = await cli(["compare", deck.html, "--json"]);
    expect(r.code, r.stderr).toBe(0);
    const report = JSON.parse(r.out) as { scores: Array<{ slide: string; score: number }> };
    expect(report.scores.map((s) => s.slide)).toEqual(["s01", "s02", "s03"]);
    for (const s of report.scores) expect(s.score, s.slide).toBeGreaterThanOrEqual(0.99);
  }, 240_000);

  it("warns below the threshold, and fails only with --strict naming slide and score (E55)", async () => {
    const { deck, refs } = await refDeck();
    const checker = img(1920, 1080, (x, y) => (((x >> 5) + (y >> 5)) % 2 ? [255, 255, 255] : [0, 0, 0]));
    writeFileSync(join(refs, "s02.png"), encodePng(checker));
    const soft = await cli(["compare", deck.html]);
    expect(soft.code, soft.stderr).toBe(0);
    expect(soft.stderr).toMatch(/warning slide s02 scores 0\.\d{3} < 0\.85/);
    expect(soft.stderr).not.toMatch(/slide s01 scores/);
    const strict = await cli(["compare", deck.html, "--strict"]);
    expect(strict.code).not.toBe(0);
    expect(strict.stderr).toMatch(/below threshold 0\.85: s02 0\.\d{3}/);
  }, 240_000);

  it("--json prints exactly one JSON document, even with fallbacks and transitions (review)", async () => {
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }, { id: "s02" }] });
    const r = await cli(["compare", deck.html, "--json", "--transition", "-o", join(deck.dir, "cmp")]);
    expect(r.code, r.stderr).toBe(0);
    const report = JSON.parse(r.out) as { transitions: string[] };
    expect(report.transitions).toHaveLength(3);
  }, 240_000);

  it("writes 25/50/75 % frames per transition and scores none of them (E57)", async () => {
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }, { id: "s02" }, { id: "s03" }] });
    const out = join(deck.dir, "cmp");
    const r = await cli(["compare", deck.html, "--transition", "-o", out]);
    expect(r.code, r.stderr).toBe(0);
    const frames = readdirSync(join(out, "transitions")).sort();
    expect(frames).toEqual(["s01-s02-25.png", "s01-s02-50.png", "s01-s02-75.png", "s02-s03-25.png", "s02-s03-50.png", "s02-s03-75.png"]);
    expect(r.out).not.toMatch(/transitions\/.*\t/);
    expect(r.out).toMatch(/no slide has a reference render/);
  }, 240_000);
});
