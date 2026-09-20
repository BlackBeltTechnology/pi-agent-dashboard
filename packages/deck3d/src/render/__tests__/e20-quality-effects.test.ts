/**
 * E20 (task 10.20) — render: quality tiers vs explicit override.
 *
 * Decision table: `quality` (deck default) × `overrides.effects` (deck-level
 * effect list, folded into every slide's effective list by `applyOverrides`).
 * The runtime's `__deck3d.effects().active` is the composer pass list, so a
 * `bloom` post effect requested via `overrides.effects` must add the
 * `UnrealBloomPass` even at `quality: low` — and that over-budget slide must
 * warn `warn budget slide <id> <sum> > <limit>` on `render`'s stderr.
 *
 * The slide's own effects (`aurora` cost 3 + `glass` cost 2 = 5) make the
 * `low` budget (6) overflow only once `bloom` (cost 2) is added.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import type { DeckIR, EffectRef } from "../../ir/types.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();
const BLOOM = "UnrealBloomPass";

/** One-slide IR: slide effects cost 5 (aurora 3 + glass 2) unless overridden. */
function deck(quality: "low" | "medium" | "high", effects: EffectRef[]): DeckIR {
  const ir = validIR();
  ir.defaults.quality = quality;
  ir.overrides.deck = { quality };
  ir.slides[0].effects = [{ id: "aurora" }, { id: "glass" }];
  ir.overrides.effects = effects;
  return ir;
}

async function renderAndReadActive(browser: Browser, ir: DeckIR): Promise<{ active: string[]; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-render-e20-"));
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  const render = spawnSync(BIN, ["render", "deck.json", "-o", "deck.html"], { cwd: dir, encoding: "utf8" });
  expect(render.status, render.stderr).toBe(0);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(join(dir, "deck.html")).href);
    await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
    const active = (await page.evaluate(() => window.__deck3d?.effects().active)) ?? [];
    return { active, stderr: render.stderr };
  } finally {
    await page.close();
  }
}

describe.skipIf(!hasChromium)("E20 quality tiers vs explicit effects (chromium)", () => {
  it("low fits without bloom; bloom at low is forced and over budget; medium/high bloom by default", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      // low + [] → no bloom, in budget.
      const lowBudget = await renderAndReadActive(browser, deck("low", []));
      expect(lowBudget.active).not.toContain(BLOOM);
      expect(lowBudget.stderr).not.toContain("warn budget");

      // low + ["bloom"] → bloom present, over the low budget (6).
      const lowBloom = await renderAndReadActive(browser, deck("low", [{ id: "bloom" }]));
      expect(lowBloom.active).toContain(BLOOM);
      expect(lowBloom.stderr).toContain("warn budget slide intro 7 > 6");

      // medium/high + [] → bloom by quality tier, no warning.
      for (const quality of ["medium", "high"] as const) {
        const tier = await renderAndReadActive(browser, deck(quality, []));
        expect(tier.active, quality).toContain(BLOOM);
        expect(tier.stderr).not.toContain("warn budget");
      }
    } finally {
      await browser.close();
    }
  }, 180_000);
});

/**
 * test-plan #P2 — the quality tier must actually buy something. Each topic
 * background reports its instance count on `object.userData.count`; `low` must
 * come in at or under half of `high`, or the tier is decorative.
 */
const TOPIC_BACKGROUNDS = [
  "globe-arcs",
  "city-grid",
  "neural-mesh",
  "vault-glyphs",
  "server-racks",
  "market-tape",
  "orbit-agents",
  "paper-stack",
];

describe("P2 topic backgrounds scale with the quality tier", () => {
  it.each(TOPIC_BACKGROUNDS)("%s at low is at most half of high", async (id) => {
    const { REGISTRY } = await import("../../fx/index.js");
    const { resolvePalette } = await import("../../runtime/palette.js");
    const { qualityProfile } = await import("../../runtime/quality.js");
    const { makeRng } = await import("../../runtime/rng.js");
    const THREE = await import("three");

    const countAt = (tier: "low" | "high"): number => {
      const handle = REGISTRY[id].create(
        {
          THREE,
          palette: resolvePalette({ palette: "blackbelt", mode: "dark" }),
          mode: "dark",
          quality: qualityProfile(tier),
          rng: makeRng(5),
          slide: { id: "s", title: "t", kind: "content" },
        },
        {},
      );
      const n = handle.object?.userData.count as number;
      handle.dispose();
      return n;
    };

    const high = countAt("high");
    const low = countAt("low");
    expect(high, `${id} high`).toBeGreaterThan(0);
    expect(low / high, `${id} low/high`).toBeLessThanOrEqual(0.5);
  });
});

/**
 * test-plan #F3 (scene side) — a palette change must reach the rendered frame,
 * not just the panel's own widgets.
 *
 * This asserts the resulting COLOUR, not merely that the frame changed. The
 * camera carries a permanent idle drift (`index.ts` `frame()`), so consecutive
 * screenshots always differ and a `Buffer.compare(...) !== 0` assertion cannot
 * fail — that spelling passed while the palette reached nothing but the rim
 * light.
 */
describe.skipIf(!hasChromium)("F3 configurator palette reaches the scene (chromium)", () => {
  it("repaints the background and label colours, and leaves __DECK alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-f3scene-"));
    writeFileSync(join(dir, "deck.md"), "# Geo\n\n- one\n\n# Ai\n\n- two\n");
    expect(spawnSync(BIN, ["build", "deck.md", "-o", "deck.html"], { cwd: dir, encoding: "utf8" }).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");

      const before = await page.evaluate(() => window.__deck3d!.debug.look());
      expect(before.bg).toBe("#1a1a1c"); // blackbelt dark

      await page.selectOption('#deck3d-hud select[data-path="palette"]', "ember");
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => window.__deck3d!.debug.look());

      // ember dark: bg #1C1917, accent #F59E0B. Background, fog and the slide's
      // own text must all move — the fog tracks the background, and the title
      // colour proves the rebuilt slide picked up the new palette.
      expect(after.bg).toBe("#1c1917");
      expect(after.fog).toBe("#1c1917");
      expect(after.rim).toBe("#f59e0b");
      // The title is drawn in the accent (`titleMaterial`), so this moving from
      // blackbelt's #ff5722 to ember's #f59e0b is what proves the slide itself
      // was rebuilt — `applyLook` cannot reach a baked material.
      expect(before.title).toBe("#ff5722");
      expect(after.title).toBe("#f59e0b");

      expect(await page.evaluate(() => window.__DECK.defaults.palette)).toBe("blackbelt");
    } finally {
      await browser.close();
    }
  }, 240_000);
});

/**
 * test-plan #F9 — the geometry-bearing controls. `camera.distance` and
 * `labels.size` are baked by `buildSlideGroup` at boot, so re-running
 * `applyLook` alone cannot move them; both were silently inert.
 */
describe.skipIf(!hasChromium)("F9 configurator geometry controls preview live (chromium)", () => {
  it("moves the camera on camera.distance and resizes diagram labels on labels.size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-f9-"));
    // `labels.size` drives DIAGRAM labels (`builders.ts`), not the title, so the
    // slide needs a diagram or the control is legitimately inert.
    writeFileSync(join(dir, "deck.md"), "# Market\n\n- a\n- b\n");
    expect(spawnSync(BIN, ["parse", "deck.md", "-o", "deck.json"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    parsed.overrides = parsed.overrides ?? {};
    parsed.overrides.slides = {
      market: { diagram: { kind: "bars", data: { labels: ["aa", "bb", "cc"], values: [3, 5, 8] } } },
    };
    writeFileSync(join(dir, "deck.json"), JSON.stringify(parsed, null, 2));
    expect(spawnSync(BIN, ["render", "deck.json", "-o", "deck.html"], { cwd: dir, encoding: "utf8" }).status).toBe(0);

    const titleWidth = async (page: import("playwright").Page): Promise<number> => {
      const rect = await page.evaluate(() => window.__deck3d!.measure().find((m) => m.kind === "title")?.rect ?? null);
      expect(rect).not.toBeNull();
      return (rect as { w: number }).w;
    };
    const labelWidth = async (page: import("playwright").Page): Promise<number> => {
      const rect = await page.evaluate(() => window.__deck3d!.measure().find((m) => m.kind === "label")?.rect ?? null);
      expect(rect).not.toBeNull();
      return (rect as { w: number }).w;
    };

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");
      // Controls live in collapsible blocks; open them so the inputs are reachable.
      await page.evaluate(() => {
        for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
      });
      await page.click('#deck3d-hud button[data-scope="slide"]');

      const baseZ = await page.evaluate(() => window.__deck3d!.debug.look().camZ);
      const baseW = await titleWidth(page);

      // Pull the camera back: the projected title must shrink.
      await page.fill('#deck3d-hud input[data-path="camera.distance"]', "16");
      await page.dispatchEvent('#deck3d-hud input[data-path="camera.distance"]', "change");
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => window.__deck3d!.debug.look().camZ)).toBeGreaterThan(baseZ + 4);
      expect(await titleWidth(page)).toBeLessThan(baseW);

      // Grow the diagram type at that same distance: labels must widen.
      const pulledLabelW = await labelWidth(page);
      await page.fill('#deck3d-hud input[data-path="labels.size"]', "0.4");
      await page.dispatchEvent('#deck3d-hud input[data-path="labels.size"]', "change");
      await page.waitForTimeout(150);
      expect(await labelWidth(page)).toBeGreaterThan(pulledLabelW);

      // The embedded IR materialises the default distance; staging 16 in the
      // panel must leave that 9 alone — the panel previews, it does not write.
      expect(await page.evaluate(() => JSON.stringify(window.__DECK.slides[0].camera ?? null))).toBe('{"distance":9}');
    } finally {
      await browser.close();
    }
  }, 240_000);
});

/**
 * #F18 — a DECK-scope control must reach EVERY slide, not just the visible one.
 * Slides sit on a shared rail and neighbours stay in frame, so rebuilding only
 * `builds[cur]` leaves the rest of the deck visibly stale. Asserted on the
 * title material, which is baked per slide by `buildSlideGroup`.
 */
describe.skipIf(!hasChromium)("F18 deck scope reaches every slide (chromium)", () => {
  it("repaints a slide that was not current when the value changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-f18-"));
    writeFileSync(join(dir, "deck.md"), "# Geo\n\n- one\n\n# Ai\n\n- two\n");
    expect(spawnSync(BIN, ["build", "deck.md", "-o", "deck.html"], { cwd: dir, encoding: "utf8" }).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");

      // Deck scope is the default selection.
      await page.selectOption('#deck3d-hud select[data-path="palette"]', "ember");
      await page.waitForTimeout(200);
      expect((await page.evaluate(() => window.__deck3d!.debug.look())).title).toBe("#f59e0b");

      // Slide 2 was never current while the change was staged.
      await page.evaluate(() => window.__deck3d!.gotoSlide(2));
      await page.waitForTimeout(1500);
      expect((await page.evaluate(() => window.__deck3d!.debug.look())).title).toBe("#f59e0b");
    } finally {
      await browser.close();
    }
  }, 240_000);
});

/**
 * #F19 — when two slides carry different palettes the transition must MORPH
 * the look, not snap it. `goTo` applied the target palette at t=0 while the
 * camera glided for `durationSec`, so the background changed a full second
 * before the camera arrived.
 */
describe.skipIf(!hasChromium)("F19 palette morphs across a transition (chromium)", () => {
  it("passes through intermediate background colours instead of snapping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-f19-"));
    writeFileSync(
      join(dir, "deck.md"),
      ['<!-- deck3d: {"palette":"midnight"} -->', "# Geo", "", "- one", "", '<!-- deck3d: {"palette":"ember"} -->', "# Ai", "", "- two", ""].join("\n"),
    );
    expect(spawnSync(BIN, ["build", "deck.md", "-o", "deck.html"], { cwd: dir, encoding: "utf8" }).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });

      const from = (await page.evaluate(() => window.__deck3d!.debug.look())).bg;
      // Sample the background for the whole flight, then inspect the trace.
      const seen = (await page.evaluate(async () => {
        const out: string[] = [];
        window.__deck3d!.gotoSlide(2);
        for (let i = 0; i < 120; i++) {
          out.push(window.__deck3d!.debug.look().bg);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        return out;
      })) as string[];
      const to = (await page.evaluate(() => window.__deck3d!.debug.look())).bg;

      expect(from).not.toBe(to);
      expect(seen.at(-1)).toBe(to); // lands exactly on the target
      // The morph is the point: colours that are neither endpoint must appear.
      // The bound is 5, not "most frames": midnight #0f172a and ember #1c1917
      // are close, so the 8-bit blend quantises to only ~8 distinct steps.
      const between = seen.filter((c) => c !== from && c !== to);
      expect(between.length).toBeGreaterThan(5);
    } finally {
      await browser.close();
    }
  }, 240_000);
});
