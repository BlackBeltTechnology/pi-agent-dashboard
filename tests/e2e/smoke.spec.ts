import { test, expect } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Wiring proof only — NOT real coverage. Asserts the browser reaches the
// containerized dashboard, the shell renders, and WS is not visibly broken.
// Authoritative WS round-trip is scenario B (tasks §5.1), not here.
test.describe("smoke", () => {
  test("dashboard shell renders", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page).toHaveTitle(/PI Dashboard/i);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
  });

  // Light WS proof (option A, negative-hold): the disconnect banner
  // (role="alert", shown only after status≠connected >3s) must NOT appear.
  // No positive "connected" element exists in the app — see design.md.
  test("no disconnect banner appears (WS holds)", async ({ page }) => {
    await gotoDashboard(page);
    const disconnectBanner = page.getByRole("alert");
    // Hold ~5s (banner threshold is 3s) and confirm it never shows.
    await page.waitForTimeout(5_000);
    await expect(disconnectBanner).toHaveCount(0);
  });
});
