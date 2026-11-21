/**
 * Browser E2E — Focus mode is a reversible, server-synced overlay.
 * Scenarios: test-plan #F2 (round-trip), #F3 (cross-browser sync).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { expect, test } from "./fixtures.js";
import { resetCardPrefs, setSectionViaBus } from "./helpers/card-sections.js";
import { inContainer, pinViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

test.describe("focus mode", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.afterAll(async () => resetCardPrefs(["flows", "folder-banner"]));

  test("F2: Focus on hides blocks, Focus off restores the user's setup", async ({ page }) => {
    await ensureGitSession(page);
    await expandFolder(page, FIXTURE_GIT);
    // A normal-setup value Focus must not rewrite.
    await setSectionViaBus("flows", true);
    const toggle = page.getByTestId("focus-toggle-btn");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("folder-spawn-session-btn").first()).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("folder-spawn-session-btn")).toHaveCount(0);
    await expect(page.getByTestId("session-card-desktop").first()).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("folder-spawn-session-btn").first()).toBeVisible();
  });

  test("F3: a second browser context follows Focus without reload", async ({ page, browser }) => {
    await ensureGitSession(page);
    const other = await browser.newContext({ baseURL: BASE_URL });
    try {
      const b = await other.newPage();
      await gotoDashboard(b);
      await expect(b.getByTestId("focus-toggle-btn")).toHaveAttribute("aria-pressed", "false");
      await page.getByTestId("focus-toggle-btn").click();
      await expect(b.getByTestId("focus-toggle-btn")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
      await page.getByTestId("focus-toggle-btn").click();
      await expect(b.getByTestId("focus-toggle-btn")).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    } finally {
      await other.close();
    }
  });

  // S39 (#1134): Focus hides the folder compact chip. `kb-sample` is a
  // session-less, unconfigured project root → the "setup" rung (the same
  // fixture `folder-action-banner.spec.ts` uses); the chip is what every rung
  // renders when `folder-banner` is hidden, so it exercises the same
  // suppression path as `init-needed`. See change: sidebar-folder-ux.
  test("S39: Focus hides the folder chip; Focus off brings it back", async ({ page }) => {
    const CWD = "/fixtures/kb-sample";
    const restore = () => inContainer(`rm -f ${CWD}/.pi/settings.json && rmdir ${CWD}/.pi 2>/dev/null; true`);
    restore();
    try {
      await ensureGitSession(page);
      await pinViaBus(CWD); // idempotent — survives a pin left by an earlier run
      // Hide the banner outside Focus too, so the chip is what the folder shows.
      await setSectionViaBus("folder-banner", false);
      const chip = page.getByTestId(`folder-banner-chip-${CWD}`);
      const anyFolderBanner = page.locator(`[data-testid^="folder-banner-"][data-testid$="-${CWD}"]`);
      await expect(chip).toBeVisible({ timeout: 30_000 });

      const toggle = page.getByTestId("focus-toggle-btn");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(anyFolderBanner).toHaveCount(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(chip).toBeVisible({ timeout: 30_000 });
    } finally {
      restore();
      await unpinViaBus(CWD); // leave the shared container as found (folder-action-banner.spec pins it)
    }
  });
});
