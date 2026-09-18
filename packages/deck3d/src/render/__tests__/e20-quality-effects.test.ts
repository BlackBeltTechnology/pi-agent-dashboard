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
import { mkdtempSync, writeFileSync } from "node:fs";
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
