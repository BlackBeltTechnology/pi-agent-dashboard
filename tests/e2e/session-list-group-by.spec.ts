/**
 * Browser E2E — session-list Group by is SERVER state, shared across browsers.
 *
 * Only a real browser + server prove these: the folder-menu radio round-trips
 * through `set_folder_group_by` → `preferences.json` → `group_by_prefs_updated`;
 * a reload paints the chip from the connect snapshot (no flat→grouped flash);
 * a SECOND browser context sees a mode change live; the Settings default
 * propagates to non-overridden folders. Lane partition/hysteresis/drag are
 * unit-tested (SessionList.group-by.test.tsx, session-lanes.test.ts).
 *
 * Exemplar: folder-collapse-persistence.spec.ts.
 * See change: session-list-group-by.
 */
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { busSend } from "./helpers/folder-collapse.js";
import { expandFolder, FIXTURE_GIT, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

const CWD = FIXTURE_GIT;

function chip(page: Page, cwd = CWD): Locator {
  return page.getByTestId(`folder-group-by-chip-${cwd}`).first();
}

async function openMenu(page: Page, cwd = CWD): Promise<void> {
  await page.getByTestId(`folder-actions-menu-${cwd}`).first().click();
  await expect(page.getByTestId(`folder-actions-menu-panel-${cwd}`).first()).toBeVisible({ timeout: 10_000 });
}

async function resetPrefs(): Promise<void> {
  await busSend([
    // Shared container: an earlier spec may leave the folder collapsed, which
    // hides the session cards `ensureGitSession` looks for.
    { type: "set_folder_collapsed", path: CWD, collapsed: false },
    { type: "set_folder_group_by", path: CWD, mode: null },
    { type: "set_default_group_by", mode: "none" },
  ]);
}

test.describe("session-list group by", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  // Grouping prefs OUTLIVE the spec (preferences.json) — always put them back.
  test.beforeAll(resetPrefs);
  test.afterAll(resetPrefs);

  test("G1: choosing Location in the folder menu persists across reload and reaches a second browser live", async ({
    page,
    browser,
  }) => {
    // A card in FIXTURE_GIT specifically — `ensureGitSession` may reuse any card.
    await spawnFreshGitSession(page);
    await expandFolder(page, CWD);
    await expect(chip(page)).toHaveCount(0);

    const fresh = await browser.newContext({ baseURL: BASE_URL });
    try {
      const other = await fresh.newPage();
      await gotoDashboard(other);
      await expect(other.getByTestId(`folder-home-row-${CWD}`).first()).toBeVisible({ timeout: 30_000 });

      await openMenu(page);
      const status = page.getByTestId("folder-menu-radio-group-by-location");
      await expect(page.getByTestId("folder-menu-radio-group-by-default")).toHaveAttribute("aria-checked", "true");
      await status.click();
      await expect(chip(page)).toContainText("Location", { timeout: 15_000 });
      await expect(chip(page)).not.toContainText("default");

      // Second browser converges without reload (broadcast).
      await expect(chip(other)).toContainText("Location", { timeout: 15_000 });
    } finally {
      await fresh.close();
    }

    // Reload: chip comes from the connect snapshot.
    await gotoDashboard(page);
    await expect(chip(page)).toContainText("Location", { timeout: 30_000 });
  });

  test("G2: Settings Default grouping applies to folders without an override; Use default reverts", async ({ page }) => {
    // A card in FIXTURE_GIT specifically — `ensureGitSession` may reuse any card.
    await spawnFreshGitSession(page);
    await busSend([{ type: "set_folder_group_by", path: CWD, mode: null }]);
    await expect(chip(page)).toHaveCount(0, { timeout: 15_000 });

    await page.goto("/settings/sessions");
    const field = page.getByTestId("settings-default-grouping");
    await expect(field).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("settings-default-grouping-status").click();
    await expect(page.getByTestId("settings-default-grouping-status")).toHaveAttribute("aria-checked", "true", {
      timeout: 15_000,
    });

    await gotoDashboard(page);
    await expect(chip(page)).toContainText("Status", { timeout: 30_000 });
    await expect(chip(page)).toContainText("default");

    // Chip opens the folder menu focused on the checked radio.
    await chip(page).click();
    const def = page.getByTestId("folder-menu-radio-group-by-default");
    await expect(def).toHaveAttribute("aria-checked", "true");
    await expect(def).toContainText("Use default (Status)");
    await expect(def).toBeFocused();
  });
});
