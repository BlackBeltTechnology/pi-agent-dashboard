/**
 * E2E: pi-untrusted-content-guard recommended-extension posture (change: harden-agent-tool-guards,
 * test-plan #F12 / T.109).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the manifest entry (`status: "strongly-suggested"`, not bundled). Only the rendered
 * Recommended Extensions card proves the user sees it as "Suggested" (not "Optional"), that it is
 * not installed by default (an Install button, no Active state), and that the card offers install.
 *
 * Authored WITHOUT a runnable docker harness: first run happens in CI / ship-it.
 */
import { expect, test } from "./fixtures.js";
import { byTestId, gotoDashboard } from "./helpers/index.js";

const ID = "@blackbelt-technology/pi-untrusted-content-guard";

test.describe("untrusted-content guard posture (L3)", () => {
  test("#F12 listed as Suggested, not installed, with an install button", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/add-ons");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("package-browser").waitFor({ state: "visible", timeout: 15_000 });

    const install = page.getByTestId(`rec-install-${ID}`);
    await expect(install).toBeVisible({ timeout: 30_000 });

    // The card that owns the install button names the entry and carries the "Suggested" pill.
    const card = page.locator("div.rounded-lg").filter({ has: install }).first();
    await expect(card).toContainText("pi-untrusted-content-guard");
    await expect(card).toContainText("Suggested");
    await expect(card).not.toContainText("Optional");
    await expect(card).not.toContainText("Active");
  });
});
