/**
 * E19 (task 10.19) — render: deep link (1-based) + credits index.
 *
 * A 3-slide deck carrying one CC-BY prop gains the derived `credits` slide at
 * render time, so it has 4 addressable slides. `#3` lands on slide 3, `#4`
 * lands on the credits slide (id `credits`, not `deck3d-credits`), and an
 * out-of-range hash (`#0`, `#5`) clamps to slide 1 without a console error.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import type { PropOverride } from "../../ir/types.js";
import { sha256 } from "../../props/fetch.js";
import { vendoredPath } from "../../props/search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

/** 3-slide IR + a real (vendored GLB bytes) CC-BY prop cached on disk. */
function threeSlideDeck(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-render-e19-"));
  const bytes = new Uint8Array(readFileSync(vendoredPath("cube")));
  mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
  // Pin the real vendored GLB under a CC-BY prop cache key.
  writeFileSync(join(dir, ".deck3d", "props", "poly-pizza-robot.glb"), bytes);

  const ir = validIR();
  const slide = ir.slides[0];
  ir.slides = [
    { ...slide, index: 1, id: "intro" },
    { ...slide, index: 2, id: "second", title: "Second" },
    { ...slide, index: 3, id: "third", title: "Third" },
  ];
  const prop: PropOverride = {
    source: "poly-pizza",
    id: "robot",
    licence: "CC-BY-4.0",
    author: "Ada Lovelace",
    sha256: sha256(bytes),
    slide: "intro",
    role: "illustration",
  };
  ir.overrides.props = [prop];
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  return dir;
}

describe.skipIf(!hasChromium)("E19 deep link + credits index (chromium)", () => {
  it("clamps out-of-range hashes and addresses the derived credits slide", async () => {
    const dir = threeSlideDeck();
    const render = spawnSync(BIN, ["render", "deck.json", "-o", "deck.html"], { cwd: dir, encoding: "utf8" });
    expect(render.status, render.stderr).toBe(0);
    const file = pathToFileURL(join(dir, "deck.html")).href;

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const open = async (hash: number) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        const errors: string[] = [];
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        await page.goto(`${file}#${hash}`);
        await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
        const state = await page.evaluate(() => ({
          current: window.__deck3d?.current(),
          slideId: window.__DECK.slides[(window.__deck3d?.current() ?? 1) - 1]?.id,
          ids: window.__DECK.slides.map((s) => s.id),
        }));
        await page.close();
        return { ...state, errors };
      };

      const three = await open(3);
      expect(three.current).toBe(3);
      expect(three.errors).toEqual([]);

      const credits = await open(4);
      expect(credits.current).toBe(4);
      // The credits slide id is `credits` — never `deck3d-credits`.
      expect(credits.slideId).toBe("credits");
      expect(credits.ids).toEqual(["intro", "second", "third", "credits"]);
      expect(credits.errors).toEqual([]);

      const zero = await open(0);
      expect(zero.current).toBe(1);
      expect(zero.errors).toEqual([]);

      const five = await open(5);
      expect(five.current).toBe(1);
      expect(five.errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
