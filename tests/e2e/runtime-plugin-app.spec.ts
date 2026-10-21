import { expect, type Page, test } from "./fixtures.js";
import { CANARY_ID, collectConsoleErrors, ensureCanaryState, pluginRow, revokePlugin, trustPlugin, variantsStaged } from "./helpers/runtime-canary.js";

/**
 * L3 — a runtime-loaded embedded app (change: decouple-plugins-from-core; test-plan #F11, #F17, #X13).
 *
 * The canary claims `shell-overlay-route` `/s6/*?` (`presentation: "content"`, `depth: 1`) with a lazy `module`
 * chunk rendering `<EmbeddedApp>`, and its server entry mounts the SAME app's standalone build with `ctx.serveApp`
 * at `/apps/runtime-canary/` (a TRUSTED plugin only). Harness: default `trusted` canary (docker/test-up.sh, 7.5).
 * X13 needs the `bundled-app-kit` variant, staged only with `PI_E2E_CANARY=untrusted` (8.2).
 */

const APP_PATH = "/s6/sub";

async function expectSidebarInteractive(page: Page) {
  await expect(page.getByPlaceholder("Folder...")).toBeVisible();
}

test.describe("runtime-loaded embedded app", () => {
  test("F11: a cold deep link into a late-registered overlay route renders once the runtime plugin registers", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    // Cold load: the route is unknown to the build-time registry until the runtime listing registers the canary.
    await page.goto(APP_PATH);
    await expect(page.getByTestId("canary-view-sub")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`${APP_PATH}$`));
  });

  test("F17: embedded in the content area beside the sidebar (host API works), and the same app runs standalone", async ({ page, request }) => {
    test.setTimeout(240_000);
    await ensureCanaryState(request, "trusted");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(APP_PATH);
    await expect(page.getByTestId("canary-view-sub")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("embedded-app-topbar")).toBeVisible();
    await expect(page.getByTestId("canary-app-mode")).toHaveText("embedded");
    await expect(page.getByTestId("canary-app-dashboard-cap")).toHaveText("true");
    await expect(page.getByTestId("canary-app-health")).toHaveText("200", { timeout: 20_000 }); // host.api.fetch("/api/health")
    await expect(page.getByRole("dialog")).toHaveCount(0); // content presentation: no dialog
    await expectSidebarInteractive(page);

    // Standalone: the serveApp mount (requires the plugin trusted AT BOOT — the mount is restart-effective).
    // A harness booted untrusted (`PI_E2E_CANARY=untrusted`) refused the mount at boot: trusting now takes a restart.
    const serveApp = async () => {
      const row = await pluginRow(request, CANARY_ID).catch(() => undefined);
      return row?.status && (row.status as { serveApp?: string }).serveApp;
    };
    if ((await serveApp()) !== "mounted") {
      await request.post("/api/restart", { timeout: 10_000 }).catch(() => {});
      await expect.poll(serveApp, { timeout: 120_000, intervals: [1_000] }).toBe("mounted");
    }
    await page.goto(`/apps/${CANARY_ID}/sub`);
    await expect(page.getByTestId("canary-view-sub")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("canary-app-mode")).toHaveText("standalone");
    await expect(page.getByTestId("canary-app-dashboard-cap")).toHaveText("false");
    // (Standalone data goes through app-kit's AUTHED transport, which needs a sign-in the harness has none of — so the
    // `host.api.fetch` 200 is asserted for the embedded host only, as the scenario states.)
    await expect(page.getByTestId("embedded-app-topbar")).toHaveCount(0); // no dashboard chrome
  });

  test("X13: an app bundling its own app-kit is contained — useAppHost fails inside the claim boundary, nav stays interactive", async ({ page, request }) => {
    test.skip(!(await variantsStaged(request)), "the bundled-app-kit variant is staged only with PI_E2E_CANARY=untrusted (task 8.2)");
    const id = "runtime-canary-bundled-app-kit";
    await trustPlugin(request, id);
    try {
      const errors = collectConsoleErrors(page);
      await page.goto(`/settings/plugins/${id}`);
      await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => errors.some((e) => e.includes(id) && /useAppHost|AppHost|provider/i.test(e)), { timeout: 30_000 }).toBe(true);
      await expect(page.getByTestId("variant-bundled-app-kit")).toHaveCount(0);
      // Sidebar / settings navigation still work.
      await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Developer", exact: true }).click();
      await expect(page.getByTestId("settings-content")).toBeVisible();
      await expectSidebarInteractive(page);
    } finally {
      await revokePlugin(request, id).catch(() => {});
    }
  });
});
