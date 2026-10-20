import { expect, test } from "./fixtures.js";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Browser E2E - remote folder picker confinement (change: harden-server-capability-bounds,
// test-plan #F9).
//
// The harness browser reaches the container through the Docker port mapping, so its
// peer is the bridge gateway, not loopback: it is a REMOTE caller (design D1, Docker
// note). Typing `/` into the Add-folder picker must show the plain-language refusal
// (never the raw server string), and "Back to home" must list the shared home with
// the hint and no `..` row.

// Variant harness: the harness seeds confinement OFF by default (a remote peer through the Docker
// port mapping would otherwise break every spec that pins a per-test dir via the picker). Opt in:
//   PI_E2E_SEED=1 PI_E2E_BROWSE_CONFINEMENT=1 docker/test-up.sh -d --build
test.skip(
  process.env.PI_E2E_BROWSE_CONFINEMENT !== "1",
  "variant harness: runs on the `e2e-bounds-variants` CI leg (PI_E2E_BROWSE_CONFINEMENT=1); see .github/workflows/ci-e2e-browser.yml",
);

test.describe("remote folder picker confinement", () => {
  test("`/` is refused in plain language; home shows the hint and no `..` row", async ({ page }) => {
    // Precondition: the harness peer really is classified remote, else this proves nothing.
    const probe = await page.request.get("/api/browse?path=%2F");
    test.skip(probe.status() !== 403, "harness peer is classified local: confinement does not apply");

    await gotoDashboard(page);
    // Same entry points as `pinDirectory`: the onboarding CTA on a fresh harness, else the sidebar button.
    const onboardingCta = byTestId(page, "onboardingStep2Cta");
    if (await onboardingCta.isVisible().catch(() => false)) {
      await onboardingCta.click();
    } else {
      await byTestId(page, "dashboardAddFolderBtn").first().click();
    }
    const dialog = byTestId(page, "addFoldersDialog");
    await dialog.waitFor({ state: "visible" });
    // Wait on the status line, not a row: the same wait `pinDirectory` uses (an empty root renders zero options).
    await expect(
      dialog.getByTestId("add-folders-status-path").or(dialog.getByTestId("add-folders-status-home")),
    ).toBeVisible({ timeout: 20_000 });

    await dialog.getByRole("textbox").first().fill("/");
    const refusal = dialog.getByTestId("path-picker-outside-roots");
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    await expect(refusal).toContainText(/outside the folders this dashboard shares/i);
    await expect(dialog).not.toContainText("path outside allowed roots");

    await refusal.getByRole("button", { name: /back to home/i }).click();
    await expect(dialog.getByTestId("path-picker-confined-hint")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("option", { name: /^\.\.$/ })).toHaveCount(0);
    await expect(refusal).toHaveCount(0);
  });
});
