/**
 * Root-page visual smoke test.
 *
 * Navigates to `/` and captures the onboarding or sessionless landing page.
 */
import {
  navigateTo,
  waitForDashboardRoot,
  stabilizeForVisual,
  clearServiceWorkers,
  visualCheck,
} from "./helpers/visual-helpers.js";

describe("Dashboard Root Page", () => {
  before(async () => {
    await clearServiceWorkers(browser);
  });

  it("should display the root onboarding or landing page", async () => {
    await navigateTo(browser, "/");
    await waitForDashboardRoot(browser);

    // Wait for either onboarding content or the sessionless landing state
    // Onboarding text: "Welcome to pi-dashboard"
    // Landing state: "Select a session" or empty-state prompt
    try {
      await browser.waitUntil(
        async () => {
          const body = await browser.$("body");
          const text = await body.getText();
          return (
            text.includes("Welcome to pi-dashboard") ||
            text.includes("Select a session") ||
            text.includes("No sessions")
          );
        },
        { timeout: 10000, timeoutMsg: "Root page content not detected" }
      );
    } catch {
      // If neither text found, still take the screenshot — this may be a
      // different UI state worth capturing.
    }

    await stabilizeForVisual(browser);
    await visualCheck(browser, "root-landing-page");
  });
});
