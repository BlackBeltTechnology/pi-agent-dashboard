/**
 * Browser E2E — an idle session card with nothing to show must NOT draw an
 * empty STATUS subcard. Scenario: test-plan #F13 of fix-empty-status-subcard.
 *
 * Default harness only (`PI_BROWSER_RELAY_FAKE` unset): the browser plugin is off,
 * so no badge claim can render. The relay-fake leg's counterpart (badge appears,
 * then hides on the kill switch — #F14) lives in `browser-relay.spec.ts`.
 */
import { expect, test } from "./fixtures.js";
import { ensureGitSession } from "./helpers/index.js";

test.skip(
  process.env.PI_BROWSER_RELAY_FAKE === "1",
  "relay-fake leg seeds a relay tab, so STATUS legitimately shows; covered by browser-relay.spec.ts F14",
);

test.describe("empty STATUS subcard", () => {
  test.setTimeout(180_000);

  test("F13: an idle seeded session card shows no STATUS title", async ({ page }) => {
    await ensureGitSession(page);
    const card = page.getByTestId("session-card-desktop").first();
    await expect(card).toBeVisible({ timeout: 40_000 });
    // Let plugin/config bootstrap settle, then assert the absence holds.
    await page.waitForTimeout(1_500);
    await expect(card.getByText("STATUS", { exact: true })).toHaveCount(0);
  });
});
