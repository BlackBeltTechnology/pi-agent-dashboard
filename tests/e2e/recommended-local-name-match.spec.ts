import { test, expect } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// F3 (test-plan #F3) — decoration-mismatched local install reports Active.
//
// The test harness seeds a local checkout at
// /fixtures/local-pkg/image-fit-extension whose package.json `name` is
// `@blackbelt-technology/pi-image-fit-extension`, and registers that PATH in
// ~/.pi/agent/settings.json packages[] (see docker/test-entrypoint.sh).
//
// The directory basename (`image-fit-extension`) does NOT equal the entry's
// unscoped npm name (`pi-image-fit-extension`), so the pure-string
// `sourcesMatch` basename rule cannot match it. Only the fs-aware
// package.json#name fallback resolves the match — and it must be applied to
// `activeSources` (not just the installed rows), because `activeInPi` is what
// drives the card's action button:
//
//   activeInPi === true  -> [Remove]   (pill "Active")
//   activeInPi === false -> [Install] / [Activate]
//
// See change: match-local-installs-by-package-name.
const ENTRY_ID = "@blackbelt-technology/pi-image-fit-extension";

test.describe("recommended extensions — local install matched by package.json name", () => {
  test("decorated local checkout renders Active/Remove, not Install", async ({ page }) => {
    await gotoDashboard(page);

    await page.goto("/settings/packages");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    const packagesNav = page.getByRole("button", { name: "Packages", exact: true });
    if (await packagesNav.isVisible().catch(() => false)) {
      await packagesNav.click();
    }
    await page.getByTestId("package-browser").waitFor({ state: "visible", timeout: 15_000 });

    // The recommended list loads async (server enrich reads the seeded
    // package.json off disk), so allow the same generous timeout the sibling
    // requires-probe spec uses.
    const removeBtn = page.getByTestId(`rec-remove-${ENTRY_ID}`);
    await expect(removeBtn).toBeVisible({ timeout: 30_000 });

    // The bug this change fixes: the entry rendered as Install (treated as not
    // installed) because the name fallback was never applied to activeSources.
    await expect(page.getByTestId(`rec-install-${ENTRY_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`rec-activate-${ENTRY_ID}`)).toHaveCount(0);
  });
});
