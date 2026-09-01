/**
 * E2E: collapse-pairing-into-gateway — test-plan F3.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suite pins the link's EXISTENCE in the Security tree and the component
 * logic. This spec proves the journey an operator actually takes: activating
 * the Security "Pair a device" link swaps the route to /settings/gateway AND
 * brings the Connect-a-device section into the viewport (the land+scroll
 * decision from the scenario-design gate). Scroll position after a client-side
 * navigation is invisible to jsdom; only a real layout engine can assert it.
 *
 * No pairing payload or endpoints seeding is needed: the link is static
 * Security-tree content, and the destination section renders regardless of
 * endpoint state.
 */
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

test.describe("collapse-pairing-into-gateway — Security routes to the Gateway pairing surface", () => {
  test("F3: the Security pairing link lands on /settings/gateway with Connect-a-device in view", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/settings/security");

    const link = page.getByTestId("security-pair-link");
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();

    // Route became the Gateway page...
    await page.waitForURL(/\/settings\/gateway$/, { timeout: 15_000 });
    // ...and the Connect-a-device anchor the link targets is IN the viewport.
    const section = page.locator("#connect-a-device");
    await expect(section).toBeAttached({ timeout: 15_000 });
    await expect(section).toBeInViewport({ ratio: 0.2, timeout: 10_000 });
  });
});
