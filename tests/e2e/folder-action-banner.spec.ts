import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, pinDirectory } from "./helpers/index.js";

// Level-3 E2E for the tier-0 folder action banner (change: add-folder-action-banner).
//
// Fixture: `kb-sample` is a session-less, non-git directory with NO
// `.pi/settings.json`. Pinning it makes it a project root (isProjectRoot via the
// pin) whose checklist reports the REQUIRED artifact absent → the stable
// "Not a pi project yet" setup banner. It is deliberately NOT `sample-git`:
// spawning a session there writes `.pi/settings.json`, which correctly clears
// the banner (the feature working) but makes the fixture non-deterministic.
//
// Covers test-plan #E6 (setup banner content), #F1 (placement below the header),
// #F3 (git row / card carries no inline scaffold control), #F9 (action does not
// navigate) and #F10 (keyboard reachable).

const CWD = "/fixtures/kb-sample";

function group(page: Page): Locator {
  return page.locator('[data-testid="sortable-pinned-group"]').filter({ hasText: "kb-sample" });
}

/** Pin the fixture and make sure its card body (where the banner lives) is expanded. */
async function surfaceBanner(page: Page): Promise<Locator> {
  await ensureGitSession(page); // dashboard mode + a session so the sidebar is not onboarding
  await pinDirectory(page, CWD);
  const g = group(page);
  await expect(g).toBeVisible({ timeout: 20_000 });
  // A freshly-pinned folder may render collapsed; the banner lives in the
  // expanded body. Expand ONLY when actually collapsed (decided by the toggle's
  // title), never on a slow-rendering-but-expanded body — a premature toggle
  // would collapse it. The banner itself is gated on an async init-status probe.
  const toggle = g.getByTestId("folder-toggle-btn").first();
  if ((await toggle.getAttribute("title")) === "Expand folder") {
    await toggle.click();
  }
  const banner = g.getByTestId(`folder-banner-setup-${CWD}`);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  return g;
}

test("E6/F1: an unconfigured project root shows the setup banner below the header", async ({ page }) => {
  const g = await surfaceBanner(page);
  const banner = g.getByTestId(`folder-banner-setup-${CWD}`);
  await expect(banner).toContainText("Not a pi project yet");
  await expect(g.getByTestId(`folder-banner-setup-action-${CWD}`)).toBeVisible();

  // Placement: tier 0 sits BELOW the identity/header row.
  const bannerBox = await banner.boundingBox();
  const headerBox = await g.getByTestId(`folder-home-row-${CWD}`).boundingBox();
  if (headerBox && bannerBox) expect(bannerBox.y).toBeGreaterThan(headerBox.y);
});

test("F3: the card carries no inline scaffold control", async ({ page }) => {
  const g = await surfaceBanner(page);
  // The scaffold control lives in the banner, never as the old inline button.
  await expect(g.getByTestId("project-init-btn")).toHaveCount(0);
});

test("F10: the banner action is keyboard focusable", async ({ page }) => {
  const g = await surfaceBanner(page);
  const action = g.getByTestId(`folder-banner-setup-action-${CWD}`);
  await action.focus();
  await expect(action).toBeFocused();
});

test("F9: activating the banner action does not navigate to the directory home", async ({ page }) => {
  const g = await surfaceBanner(page);
  const before = page.url();
  await g.getByTestId(`folder-banner-setup-action-${CWD}`).click();
  // The spawn is fire-and-forget; the click must not route to the directory home.
  await expect(g.getByTestId(`folder-home-row-${CWD}`)).toBeVisible();
  expect(page.url()).toBe(before);
});
