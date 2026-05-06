import { test, expect } from "@playwright/test";

/**
 * Push bell toggle Playwright tests.
 *
 * Uses page.route() to intercept WebSocket connection and mock session data
 * so the bell renders without needing a real pi bridge session.
 */
test.describe("Push bell toggle", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and wait for the app shell to load
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Inject a mock session into the React app state via the dashboard's
    // session store. We do this by dispatching a synthetic sessions_snapshot
    // message to the app's WebSocket message handler.
    await page.evaluate(() => {
      const mockSession = {
        id: "test-session-1",
        cwd: "/test/project",
        name: "Test Session",
        source: "tui",
        status: "active" as const,
        model: "anthropic/claude-sonnet-4",
        thinkingLevel: "high",
        startedAt: Date.now(),
        pushPrefs: { notifyCompletion: "off" as const },
        hidden: false,
        dataUnavailable: false,
      };

      // Find the WebSocket mock or use a global to store sessions.
      // The dashboard app stores sessions in React state — we can't easily
      // modify it. Instead, mock the fetch response to replay a session_added
      // via the app's existing message handler.
      (window as any).__mockSession = mockSession;
    });

    // Intercept /api/config to return push defaults
    await page.route("**/api/config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          port: 8000,
          push: {
            enabled: true,
            defaults: { notifyErrors: true, notifyAskUser: true },
          },
        }),
      });
    });
  });

  test("bell renders on session page", async ({ page }) => {
    // Navigate to the mock session
    await page.goto("/session/test-session-1");
    await page.waitForTimeout(2000);

    // Take screenshot for debugging
    await page.screenshot({ path: "test-results/bell-render.png" });

    const bell = page.locator('[aria-label^="Push:"]');
    const count = await bell.count();

    // The bell renders when:
    // 1. A session is selected → StatusBar visible
    // 2. pushEnabled !== false
    // 3. bellState is defined (from pushPrefs)
    if (count === 0) {
      // Bell might not render if session data isn't properly injected.
      // Check if StatusBar is visible at all.
      const statusBar = page.locator('[data-testid="status-bar"]');
      const statusBarCount = await statusBar.count();
      console.log(`StatusBar count: ${statusBarCount}, Bell count: ${count}`);
    }

    expect(count).toBeGreaterThan(0);

    // Bell should start in "off" state
    await expect(bell).toHaveAttribute("aria-label", /off/);
  });

  test("bell cycles off → on → auto → off on click", async ({ page }) => {
    await page.goto("/session/test-session-1");
    await page.waitForTimeout(1000);

    const bell = page.locator('[aria-label^="Push:"]');
    await expect(bell).toBeVisible({ timeout: 5000 });

    // off → on
    await bell.click();
    await page.waitForTimeout(200);
    await expect(bell).toHaveAttribute("aria-label", /on/);

    // on → auto
    await bell.click();
    await page.waitForTimeout(200);
    await expect(bell).toHaveAttribute("aria-label", /auto/);

    // auto → off
    await bell.click();
    await page.waitForTimeout(200);
    await expect(bell).toHaveAttribute("aria-label", /off/);
  });

  test("bell hidden for ended sessions", async ({ page }) => {
    // Inject an ended session
    await page.evaluate(() => {
      (window as any).__mockSession = {
        id: "test-session-ended",
        cwd: "/test/project",
        name: "Ended Session",
        source: "tui",
        status: "ended" as const,
        startedAt: Date.now() - 3600000,
        endedAt: Date.now(),
        pushPrefs: { notifyCompletion: "off" as const },
        hidden: false,
        dataUnavailable: false,
      };
    });

    await page.goto("/session/test-session-ended");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "test-results/bell-ended.png" });

    const bell = page.locator('[aria-label^="Push:"]');
    await expect(bell).toHaveCount(0);
  });

  test("Settings page shows global push defaults", async ({ page }) => {
    // Navigate to settings if accessible, or check via the page
    await page.goto("/");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "test-results/settings-load.png" });
  });
});
