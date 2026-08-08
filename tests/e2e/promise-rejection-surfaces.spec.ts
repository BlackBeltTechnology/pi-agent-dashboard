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
    // rewritten call sites on this surface. REQUIRED, not best-effort: a
    // conditional click would let the row pass while exercising nothing.
    const checkNow = page.getByTestId("unified-pkg-check-now");
    await expect(checkNow).toBeVisible({ timeout: 20_000 });
    await checkNow.click();

    // The debounced search path is the third rewritten site on this surface.
    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill("pi-dashboard");

    // Settle on the control re-enabling rather than a fixed sleep — that is the
    // observable that the check actually completed.
    await expect(checkNow).toBeEnabled({ timeout: 30_000 });

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

  // test-plan #F6 — the APPLICATION's reporter observes an escaped rejection.
  //
  // An earlier version asserted that the spec's OWN init-script listener caught
  // an injected rejection. That proved only that Playwright can observe
  // `unhandledrejection`; it never exercised the app's handler, so it would
  // have passed with `installUnhandledRejectionReporter()` deleted outright.
  //
  // The app's reporter routes through `reportError`, which writes
  // "[pi-dashboard] unhandled error in unhandled rejection: <reason>" to the
  // console. Asserting on THAT record is what proves the handler is installed
  // and reporting, rather than the browser merely echoing the rejection.
  test("F6: an escaped rejection is reported by the app's own handler", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await gotoDashboard(page);

    // Fire the rejection inside the loaded app's realm, after the bundle has
    // installed its reporter — the situation the guard exists for.
    await page.evaluate(() => {
      // biome-ignore lint/nursery/noFloatingPromises: the unhandled rejection IS the fixture
      Promise.reject(new Error("app-reporter-probe"));
    });

    await expect
      .poll(() => consoleErrors.join("\n"), { timeout: 10_000 })
      .toContain("app-reporter-probe");

    const reported = consoleErrors.find((l) => l.includes("app-reporter-probe"));
    expect(reported, "reported through the client's reportError seam").toContain(
      "[pi-dashboard] unhandled error",
    );
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
