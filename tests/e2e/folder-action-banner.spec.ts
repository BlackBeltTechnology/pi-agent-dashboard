import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, pinDirectory } from "./helpers/index.js";

// Level-3 E2E for the tier-0 folder action banner (change: add-folder-action-banner).
//
// `sample-git` is a git root with NO `.pi/settings.json`, so its checklist
// reports the required artifact absent → the "Not a pi project yet" setup
// banner. This is the deterministic, browser-only surface the unit tests can't
// reach: real placement below the facts-only git row and above the slot pills,
// keyboard reachability, and the header-navigation isolation of the action.
//
// Covers test-plan #F1 (placement with a git row), #F3 (git row is facts-only),
// #F9 (action neither collapses nor navigates), #F10 (keyboard reachable) and
// the rendered half of #E6 (setup banner content).

const CWD = FIXTURE_GIT;

function group(page: Page): Locator {
  return page.locator('[data-testid="sortable-pinned-group"]').filter({ hasText: "sample-git" });
}

test.beforeEach(async ({ page }) => {
  await ensureGitSession(page);
  await pinDirectory(page, CWD);
});

test("E6/F1: an unconfigured git root shows the setup banner below the git row", async ({ page }) => {
  const g = group(page);
  const banner = g.getByTestId(`folder-banner-setup-${CWD}`);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Not a pi project yet");
  await expect(g.getByTestId(`folder-banner-setup-action-${CWD}`)).toBeVisible();

  // Placement: the banner sits BELOW the identity/header row (tier 0 is under
  // the identity block).
  const bannerBox = await banner.boundingBox();
  const headerBox = await g.getByTestId(`folder-home-row-${CWD}`).boundingBox();
  if (headerBox && bannerBox) expect(bannerBox.y).toBeGreaterThan(headerBox.y);
});

test("F3: the git row carries no call-to-action control", async ({ page }) => {
  const g = group(page);
  await expect(g.getByTestId(`folder-banner-setup-${CWD}`)).toBeVisible({ timeout: 20_000 });
  // The scaffold control lives in the banner, never inline on the git row.
  await expect(g.getByTestId("project-init-btn")).toHaveCount(0);
});

test("F10: the banner action is keyboard focusable", async ({ page }) => {
  const g = group(page);
  const action = g.getByTestId(`folder-banner-setup-action-${CWD}`);
  await expect(action).toBeVisible({ timeout: 20_000 });
  await action.focus();
  await expect(action).toBeFocused();
});

test("F9: activating the banner action does not navigate to the directory home", async ({ page }) => {
  const g = group(page);
  const action = g.getByTestId(`folder-banner-setup-action-${CWD}`);
  await expect(action).toBeVisible({ timeout: 20_000 });
  const before = page.url();
  await action.click();
  // The spawn is fire-and-forget; the folder must not collapse or route to the
  // directory home as a side effect of the click.
  await expect(g.getByTestId(`folder-home-row-${CWD}`)).toBeVisible();
  expect(page.url()).toBe(before);
});
