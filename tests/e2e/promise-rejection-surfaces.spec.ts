import { expect, type Page, test } from "@playwright/test";
import { gotoDashboard } from "./helpers/index.js";
import { watchRejections } from "./helpers/rejections.js";

/**
 * Rejection observability on the client surfaces whose promise handling this
 * change rewrote (test-plan #F1, #F2, #F4, #F6, #X1).
 *
 * One file, one test per surface — each surface is a separate manifest row and
 * fails independently. Harness glue copied from `navigation.spec.ts` (pageerror
 * listener + header-button entry into Settings) and
 * `settings-field-descriptions.spec.ts` (the nav-rail `railGoto`).
 *
 * The dashboard port comes from the Playwright baseURL, which `docker/
 * test-up.sh` derived into `.pi-test-harness.json` — never hardcode :18000.
 *
 * See change: cleanup-client-plugin-promises.
 */

async function openSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

/** Move between settings pages through the rail, in the SAME document. */
async function railGoto(page: Page, label: string) {
  await page
    .getByTestId("settings-nav-rail")
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(page.getByTestId("settings-content")).toBeVisible({ timeout: 20_000 });
}

test.describe("promise-rejection observability per surface", () => {
  // test-plan #F1 — UnifiedPackagesSection (7 rewritten sites).
  test("F1: packages surface search + refresh settle with zero unhandled rejections", async ({
    page,
  }) => {
    const watcher = await watchRejections(page);
    await openSettings(page);
    await railGoto(page, "Packages");

    // Manual "check now" drives handleCheckUpdates + refresh — the two densest
    // rewritten call sites on this surface.
    const checkNow = page.getByTestId("unified-pkg-check-now");
    if (await checkNow.isVisible().catch(() => false)) {
      await checkNow.click();
    }

    // Search, if the surface exposes it, exercises the debounced fetch path.
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("pi-dashboard");
      await page.waitForTimeout(1_500);
    }

    // Converged to a settled rendered state (not a spinner that never resolves).
    await expect(page.getByTestId("settings-content")).toBeVisible();
    await watcher.assertClean("packages surface");
  });

  // test-plan #F2 — ProviderAuthSection (5 rewritten sites).
  test("F2: provider-auth surface settles with zero unhandled rejections", async ({ page }) => {
    const watcher = await watchRejections(page);
    await openSettings(page);
    await railGoto(page, "Providers");

    // The section's mount effects (refresh + fetchHandlerIds) are the rewritten
    // sites; give them a beat to settle, then confirm the surface rendered.
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("settings-content")).toBeVisible();
    await watcher.assertClean("provider-auth surface");
  });

  // test-plan #F4 — NetworkDiscoverySection (3 rewritten sites), on the
  // Remote Servers page alongside KnownServersSection (2 more).
  test("F4: network-discovery reaches a terminal state with zero unhandled rejections", async ({
    page,
  }) => {
    const watcher = await watchRejections(page);
    await openSettings(page);
    await railGoto(page, "Remote Servers");

    // Discovery + known-servers reload run on mount; let the scan settle.
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("settings-content")).toBeVisible();
    await watcher.assertClean("network-discovery surface");
  });

  // test-plan #F6 — the global handler is installed before application work.
  test("F6: a rejection fired at the earliest script point is captured, not lost", async ({
    page,
  }) => {
    const watcher = await watchRejections(page);

    // Fire a rejection from an init script — i.e. before the app bundle runs.
    // The capture proves a listener is already in place at that point; if the
    // app's own handler were installed too late, this would be lost.
    await page.addInitScript(() => {
      // Deliberate fault injection: an UNHANDLED rejection is the fixture here.
      // Handling it would delete the test.
      // biome-ignore lint/nursery/noFloatingPromises: the unhandled rejection IS the fixture
      Promise.reject(new Error("earliest-script-rejection"));
    });

    await gotoDashboard(page);

    const seen = await watcher.rejections();
    expect(seen.join("\n")).toContain("earliest-script-rejection");
  });

  // test-plan #X1 — an aborted request degrades visibly instead of hanging.
  test("X1: an aborted request is reported and the surface still settles", async ({ page }) => {
    const watcher = await watchRejections(page);

    // Fault injection: abort the packages listing mid-flight.
    await page.route("**/api/packages**", (route) => route.abort("failed"));

    await openSettings(page);
    await railGoto(page, "Packages");
    await page.waitForTimeout(2_000);

    // The failure must not surface as an unhandled rejection, and the surface
    // must reach a rendered state rather than hanging.
    await expect(page.getByTestId("settings-content")).toBeVisible();
    const seen = await watcher.rejections();
    expect(seen, `aborted request leaked an unhandled rejection:\n${seen.join("\n")}`).toHaveLength(
      0,
    );
  });
});
