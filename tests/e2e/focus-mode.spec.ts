/**
 * Browser E2E — Focus mode is a reversible, server-synced overlay.
 * Scenarios: test-plan #F2 (round-trip), #F3 (cross-browser sync).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { expect, test } from "./fixtures.js";
import { resetCardPrefs, setSectionViaBus } from "./helpers/card-sections.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

test.describe("focus mode", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.afterAll(async () => resetCardPrefs(["flows"]));

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
});
