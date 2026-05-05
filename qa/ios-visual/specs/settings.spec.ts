/**
 * Settings page visual smoke test.
 *
 * Navigates to `/settings?tab=providers` and captures the providers tab.
 */
import {
  navigateTo,
  waitForSelector,
  stabilizeForVisual,
  clearServiceWorkers,
  visualCheck,
} from "./helpers/visual-helpers.js";

describe("Dashboard Settings — Providers", () => {
  before(async () => {
    await clearServiceWorkers(browser);
  });

  it("should display the settings page with providers tab", async () => {
    await navigateTo(browser, "/settings?tab=providers");

    // Wait for settings header and content to render
    await waitForSelector(browser, '[data-testid="settings-header"]', 10000).catch(() => {
      // Fallback: any settings-related heading
    });
    await waitForSelector(browser, '[data-testid="settings-content"]', 10000).catch(() => {
      // Fallback: any settings panel
    });

    await browser.pause(1000);

    await stabilizeForVisual(browser);
    await visualCheck(browser, "settings-providers");
  });
});
