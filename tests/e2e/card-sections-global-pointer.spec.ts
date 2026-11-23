/**
 * Browser E2E — the Directory Settings › Session cards page points to the
 * global defaults: `Edit global defaults →` opens Settings › General scrolled
 * to the `Session card sections` block (one-shot `?scroll=`, replaced away),
 * browser Back / Escape return to the folder page, and a repeat trip scrolls
 * again. Scenarios: test-plan #F2, #F3.
 * See change: card-sections-global-pointer.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

const CWD = Buffer.from(FIXTURE_GIT).toString("base64url");
const CARDS_URL = `/folder/${CWD}/settings/cards`;
const CARDS_RE = new RegExp(`/folder/${CWD}/settings/cards$`);

test.describe("card sections global pointer", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  async function openCardsPage(page: Page) {
    await ensureGitSession(page);
    await gotoDashboard(page, CARDS_URL);
    await expect(page.getByTestId("card-sections-override-summary")).toBeVisible({ timeout: 20_000 });
  }

  async function followPointer(page: Page) {
    await page.getByTestId("card-sections-open-global").click();
    // The one-shot param is consumed and replaced away once the block scrolled in.
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(page.getByTestId("card-sections-settings")).toBeInViewport();
  }

  test("F2: link scrolls to the global block; Back returns; a repeat trip scrolls again", async ({ page }) => {
    await openCardsPage(page);
    await followPointer(page);

    await page.goBack();
    await expect(page).toHaveURL(CARDS_RE);
    await expect(page.getByTestId("card-sections-override-summary")).toBeVisible();

    await followPointer(page);
  });

  test("F3: Escape from Settings reached via the link lands on the folder page", async ({ page }) => {
    await openCardsPage(page);
    await followPointer(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(CARDS_RE);
  });
});
