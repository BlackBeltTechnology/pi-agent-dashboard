import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { contrastFailures, measureText, nonTextFailures, setThemeMode, sizeFailures } from "./helpers/computed-contrast.js";
import { FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";

/**
 * Related card pills read in the light theme (theme-system "Card pill colour
 * roles"): the sidebar filter chips (include-archive + one `ToggleButton`), the
 * pinned-folder indicator, and the archive browser's artifact letters.
 *
 * Fixture: `/fixtures/sample-git` (pinned) and its seeded archived change
 * `2026-07-15-e2e-archived-demo`, which carries proposal / design / specs / tasks.
 *
 * Covers test-plan #F6.
 * See change: fix-folder-card-pill-contrast.
 */

const ARCHIVE_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/openspec/archive`;

/** Worst text ratio of the chip's own text (the chip is a button: one text node + optional icon). */
async function chipRatio(chip: Locator): Promise<number> {
  const ms = await measureText(chip);
  expect(ms.length, "chip owns at least one text node").toBeGreaterThan(0);
  return Math.min(...ms.map((m) => m.ratio));
}

async function pinFixture(page: Page): Promise<void> {
  const home = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first();
  if (!(await home.isVisible().catch(() => false))) await pinDirectory(page, FIXTURE_GIT);
  await home.waitFor({ state: "visible", timeout: 30_000 });
}

test("F6: chips, pin indicator and artifact letters read in base light", async ({ page }) => {
  await gotoDashboard(page);
  await setThemeMode(page, "light", "base");
  await pinFixture(page);

  // Pinned indicator: inert svg glyph, ≥ 3:1 (WCAG 1.4.11).
  const pin = page.getByTestId(`folder-pinned-indicator-${FIXTURE_GIT}`).first();
  await expect(pin).toBeVisible({ timeout: 20_000 });
  expect(await nonTextFailures(pin, 3), "pinned indicator glyph").toEqual([]);

  // Sidebar chips: unpressed → pressed → unpressed. Text ≥ 4.5:1 in every state
  // and the pressed text is never less readable than the unpressed one.
  const chips: Array<[string, Locator]> = [
    ["include-archive", page.getByTestId("search-include-archive").first()],
    ["Hidden ToggleButton", page.getByRole("button", { name: "Hidden", exact: true }).first()],
  ];
  for (const [name, chip] of chips) {
    await expect(chip, name).toBeVisible({ timeout: 20_000 });
    const off = await chipRatio(chip);
    expect(contrastFailures(await measureText(chip), 4.5), `${name} unpressed`).toEqual([]);
    expect(sizeFailures(await measureText(chip)), `${name} unpressed size`).toEqual([]);

    await chip.click();
    await expect(chip, `${name} pressed`).toHaveAttribute("class", /accent-soft/);
    const on = await chipRatio(chip);
    expect(contrastFailures(await measureText(chip), 4.5), `${name} pressed`).toEqual([]);
    expect(on + 0.01, `${name}: pressed ratio ≥ unpressed`).toBeGreaterThanOrEqual(off);

    await chip.click();
    await expect(chip, `${name} unpressed again`).not.toHaveAttribute("class", /accent-soft/);
    expect(contrastFailures(await measureText(chip), 4.5), `${name} unpressed again`).toEqual([]);
  }

  // Archive browser: artifact letters ≥ 4.5:1 and ≥ 12 px.
  await page.goto(ARCHIVE_URL);
  await page.getByTestId("archive-browser").waitFor({ state: "visible", timeout: 20_000 });
  const letters = page.getByTestId("artifact-letter");
  await letters.first().waitFor({ state: "visible", timeout: 20_000 });
  const letterMs = await measureText(page.getByTestId("archive-entry").first());
  const lettersOnly = letterMs.filter((m) => m.where.includes("artifact-letter"));
  expect(lettersOnly.length, "artifact letters measured").toBeGreaterThan(0);
  expect(contrastFailures(lettersOnly, 4.5), "artifact letter contrast").toEqual([]);
  expect(sizeFailures(lettersOnly, { dense: 12, interactive: 12 }), "artifact letter size").toEqual([]);
});
