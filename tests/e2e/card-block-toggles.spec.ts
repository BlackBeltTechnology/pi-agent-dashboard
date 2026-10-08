/**
 * Browser E2E — per-block card toggles reach the rendered sidebar and survive
 * a reload. Scenario: test-plan #F1.
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { expect, test } from "./fixtures.js";
import { resetCardPrefs, setSectionViaBus } from "./helpers/card-sections.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, folderCard, gotoDashboard } from "./helpers/index.js";

const KEYS = ["pill-automation", "folder-create"];

test.describe("card block toggles", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.afterAll(async () => resetCardPrefs(KEYS));

  test("F1: hiding the Automations pill removes only that pill, and stays hidden after reload", async ({ page }) => {
    await ensureGitSession(page);
    await expandFolder(page, FIXTURE_GIT);
    const card = folderCard(page, FIXTURE_GIT);
    await expect(card.getByTestId("folder-automation-section")).toHaveCount(1);

    await setSectionViaBus("pill-automation", false);
    await expect(card.getByTestId("folder-automation-section")).toHaveCount(0);
    // Other blocks are untouched.
    await expect(page.getByTestId(`folder-body-${FIXTURE_GIT}`).getByTestId("folder-spawn-session-btn")).toHaveCount(1);

    await gotoDashboard(page);
    await expandFolder(page, FIXTURE_GIT);
    await expect(folderCard(page, FIXTURE_GIT).getByTestId("folder-automation-section")).toHaveCount(0);
  });

  test("hiding folder-create removes the Create buttons everywhere", async ({ page }) => {
    await ensureGitSession(page);
    await expandFolder(page, FIXTURE_GIT);
    await setSectionViaBus("folder-create", false);
    await expect(page.getByTestId("folder-spawn-session-btn")).toHaveCount(0);
    await setSectionViaBus("folder-create", null);
    await expect(page.getByTestId("folder-spawn-session-btn").first()).toBeVisible();
  });
});
