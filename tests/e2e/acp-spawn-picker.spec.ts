import { expect, test } from "./fixtures.js";
import { ensureFixtureGitGroup, gotoDashboard } from "./helpers/index.js";

/**
 * Spawn picker (WAI-ARIA menu button) in the browser: keyboard operation,
 * per-folder memory and the unchanged-when-pi default (test-plan #F9/#F10/#F11).
 *
 * See change: add-acp-session-driver (tasks 7.83, 7.84).
 */
test.describe("ACP spawn picker", () => {
  test("opens with the chevron, is a menu of radios and Escape returns focus", async ({ page }) => {
    await gotoDashboard(page);
    const body = await ensureFixtureGitGroup(page);
    const chevron = body.getByTestId("folder-spawn-session-btn-chevron");
    await expect(chevron).toHaveAttribute("aria-haspopup", "menu");
    await chevron.click();

    const menu = page.getByTestId("folder-spawn-session-btn-menu");
    await expect(menu).toHaveAttribute("role", "menu");
    const items = menu.getByRole("menuitemradio");
    await expect(items).toHaveCount(5); // pi + 4 seeded agents
    await expect(items.first()).toHaveAttribute("aria-checked", "true");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(chevron).toBeFocused();
    await expect(body.getByTestId("folder-spawn-session-btn-agent")).toContainText("QueryMT");

    await chevron.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(chevron).toBeFocused();
  });

  test("the chosen agent is remembered per folder across a reload", async ({ page }) => {
    await gotoDashboard(page);
    let body = await ensureFixtureGitGroup(page);
    await body.getByTestId("folder-spawn-session-btn-chevron").click();
    await page.getByTestId("folder-spawn-session-btn-menu").locator('[data-agent="qmt-perm"]').click();
    await page.reload();
    body = await ensureFixtureGitGroup(page);
    await expect(body.getByTestId("folder-spawn-session-btn-agent")).toContainText("QueryMT Perm");

    // restore the default so later specs start from pi
    await body.getByTestId("folder-spawn-session-btn-chevron").click();
    await page.getByTestId("folder-spawn-session-btn-menu").locator('[data-agent="pi"]').click();
    await expect(body.getByTestId("folder-spawn-session-btn-agent")).toContainText("pi");
  });
});
