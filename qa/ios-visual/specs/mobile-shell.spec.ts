/**
 * Mobile-shell visual smoke test.
 *
 * Exercises the dashboard mobile layout at iPhone viewport size without
 * spawning real sessions or requiring credentials.
 */
import {
  navigateTo,
  waitForDashboardRoot,
  stabilizeForVisual,
  clearServiceWorkers,
  scrollToTop,
  visualCheck,
} from "./helpers/visual-helpers.js";

describe("Dashboard Mobile Shell", () => {
  before(async () => {
    await clearServiceWorkers(browser);
  });

  it("should display mobile shell layout at iPhone viewport", async () => {
    // Navigate to root — mobile shell applies via CSS media queries
    // and the useMobile() hook based on viewport width (~390px for iPhone)
    await navigateTo(browser, "/");
    await waitForDashboardRoot(browser);

    // Wait for mobile-specific elements
    await browser.pause(1000);

    try {
      // Mobile shell typically has a bottom nav or hamburger menu
      const hasMobileShell = await browser.execute(() => {
        // Check for common mobile-shell indicators
        const bottomNav = document.querySelector(
          '[data-testid="mobile-nav"], .mobile-nav, [class*="MobileShell"]'
        );
        return !!bottomNav;
      });

      if (!hasMobileShell) {
        // May need viewport to be set explicitly — taken from WDIO capabilities
        console.log(
          "Mobile shell not detected — check WDIO viewport configuration"
        );
      }
    } catch {
      // Continue with checkpoint
    }

    await stabilizeForVisual(browser);
    await scrollToTop(browser);
    await visualCheck(browser, "mobile-shell-root");
  });

  it("should display mobile session detail routing", async () => {
    await navigateTo(browser, "/session/fixture-session-active");
    await browser.pause(1500);

    await stabilizeForVisual(browser);
    await scrollToTop(browser);
    await visualCheck(browser, "mobile-shell-session-detail");
  });
});
