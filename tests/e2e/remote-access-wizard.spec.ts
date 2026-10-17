import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { openRemoteAccess } from "./helpers/remote-access.js";

/**
 * Browser E2E for change `add-remote-access-wizard` — the Remote access dialog
 * against the docker harness defaults: the container binds `0.0.0.0` through
 * `PI_DASHBOARD_HOST` (docker/compose.yml), accepts no LAN requests and runs no
 * tunnel. Restart/resume is covered at L1 only: the harness already listens on
 * all interfaces, so the restart path cannot be driven here.
 *
 * Nothing is stubbed — these assert the landing and the step plan converge on
 * what the REAL server reports.
 */
test.describe("remote access wizard (harness defaults)", () => {
  // The first-launch display modal opens when the container has no stored
  // display prefs and its backdrop then intercepts every click. Seed prefs once.
  test.beforeAll(async ({ request }) => {
    await request.patch("/api/preferences/display", { data: { debugTools: false } });
  });

  // F1 — the landing shows who can reach this machine before any task.
  test("F1: landing — LAN listening but requests off, Internet off, four tasks", async ({ page }) => {
    await gotoDashboard(page);
    await openRemoteAccess(page);

    await expect(page.getByTestId("gateway-dialog")).toBeVisible();
    await expect(page.getByTestId("remote-access-road-lan-state")).toContainText("Listening, but requests are off", { timeout: 15_000 });
    await expect(page.getByTestId("remote-access-road-internet")).toContainText("Off");
    for (const id of ["share", "device", "lan", "connect"]) {
      await expect(page.getByTestId(`remote-access-task-${id}`)).toBeVisible();
    }
  });

  // F2 — a server that already binds every interface skips Listen on network.
  test("F2: Allow devices on my network — Listen on network is already set, Let devices ask is current", async ({ page }) => {
    await gotoDashboard(page);
    await openRemoteAccess(page);
    await page.getByTestId("remote-access-task-lan").click();

    const listen = page.getByTestId("remote-access-step-open-bind");
    await expect(listen).toContainText("all networks (0.0.0.0)", { timeout: 15_000 });
    await expect(listen).toContainText("already set");
    await expect(page.getByTestId("remote-access-step-accept")).toHaveAttribute("data-state", "current");
  });
});
