import type { Locator } from "@playwright/test";
import { showing, statsAre } from "./fixtures/retro-ux/kb-pill.js";
import { expect, test } from "./fixtures.js";
import { contrastFailures, measureText, nonTextFailures, setThemeMode, sizeFailures } from "./helpers/computed-contrast.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Slot pills of a pinned folder card read in the light theme: every glyph chip
 * svg ≥ 3:1 (WCAG 1.4.11), every text node ≥ 4.5:1 and ≥ 11 px.
 *
 * Fixture: `kb-sample` (writable, session-less folder with a knowledge_base.json);
 * pinning it surfaces the KB pill, and the folder card's slot-pill grid holds it
 * together with whichever plugin pills (Automations / Goals / OpenSpec / MCP) the
 * harness enables. `/api/kb/stats` is stubbed so the KB pill is deterministic.
 *
 * Covers test-plan #F5.
 * See change: fix-folder-card-pill-contrast.
 */

/** The slot-pill grid: nearest `grid-cols-1` ancestor of the KB section (see SessionList "Slot-pill grid"). */
function pillGrid(page: import("@playwright/test").Page): Locator {
  return page.getByTestId("folder-kb-section").first().locator("xpath=ancestor::div[contains(@class,'grid-cols-1')][1]");
}

test("F5: slot-pill glyphs ≥ 3:1 and text ≥ 4.5:1 / ≥ 11 px in base light", async ({ page }) => {
  await statsAre({})(page);
  await gotoDashboard(page);
  await showing("populated")(page); // pins the kb-sample fixture when no KB pill exists yet
  await setThemeMode(page, "light", "base");
  await showing("populated")(page);

  const grid = pillGrid(page);
  await expect(grid).toBeVisible();

  const text = await measureText(grid);
  expect(text.length, "measured text nodes").toBeGreaterThan(0);
  expect(contrastFailures(text, 4.5)).toEqual([]);
  expect(sizeFailures(text, { dense: 11 })).toEqual([]);

  expect(await grid.locator("svg").count(), "glyph svgs in the grid").toBeGreaterThan(0);
  expect(await nonTextFailures(grid, 3)).toEqual([]);
});
