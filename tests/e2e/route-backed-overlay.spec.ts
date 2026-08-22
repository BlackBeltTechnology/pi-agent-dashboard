import { expect, test } from "./fixtures.js";

/**
 * Browser E2E — route-backed overlays (change: add-route-backed-overlay-dialogs).
 *
 * These assert the ONE-URL-ONE-SURFACE rule that design D5 rests on, and they
 * need a real browser: nothing unit-tests `App`, so the container wiring in
 * App.tsx has no jsdom coverage at all. The pure resolution underneath (which
 * route dismisses to where) is unit-tested in overlay-background.test.ts.
 *
 *   S-12 — at `/tunnel-setup` exactly one overlay is mounted; settings is NOT
 *          mounted simultaneously. This is the whole of "replaces, not stacks":
 *          `/tunnel-setup` is its own URL, so `settingsMatch` is false there.
 *   S-13 — dismissing leaves the surface and changes the URL.
 *
 * S-13 is covered here in its COLD-LOAD form only. The plan states it as
 * "opened /tunnel-setup from /settings/gateway", but no in-app affordance
 * navigates to /tunnel-setup anywhere in the repo today — it is reachable by URL
 * alone. Driving it via a synthetic history push would assert the test's own
 * setup rather than a user path. The launcher-based return to /settings/gateway
 * is pinned instead at the unit level (resolveDismissTarget, D1d).
 */

test.describe("route-backed overlays", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("S-12: /tunnel-setup mounts exactly one overlay and settings is not mounted", async ({
    page,
  }) => {
    await page.goto("/tunnel-setup");

    const tunnel = page.getByTestId("tunnel-setup-overlay");
    await expect(tunnel).toBeVisible({ timeout: 15_000 });

    // The stacking claim, stated as a count rather than a look: settings is a
    // sibling branch on the same tree, so if the two could ever coexist this is
    // where it would show.
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("S-13 (cold load): dismissing /tunnel-setup leaves the surface", async ({ page }) => {
    await page.goto("/tunnel-setup");
    await expect(page.getByTestId("tunnel-setup-overlay")).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("Escape");

    // Dismissal must not be a no-op — the cold-load target is resolved from the
    // RouteDescriptor table, which is why group 2's depth work is load-bearing
    // on this path too.
    await expect(page.getByTestId("tunnel-setup-overlay")).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/tunnel-setup$/);
  });

  test("S-12b: /settings mounts exactly one overlay and tunnel setup is not mounted", async ({
    page,
  }) => {
    // The mirror of S-12. Without it, S-12 would still pass if the tunnel branch
    // simply never rendered settings under any circumstances.
    await page.goto("/settings/gateway");

    await expect(page.getByTestId("settings-overlay")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tunnel-setup-overlay")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
});
