import { expect, test } from "./fixtures.js";
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
//   activeInPi === true  -> installed row only (card hidden: recommended once)
//   activeInPi === false -> [Install] / [Activate] card
//
// See change: match-local-installs-by-package-name.
const ENTRY_ID = "@blackbelt-technology/pi-image-fit-extension";

test.describe("recommended extensions — local install matched by package.json name", () => {
  test("decorated local checkout renders Active/Remove, not Install", async ({ page }) => {
    await gotoDashboard(page);

    await page.goto("/settings/add-ons");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    const packagesNav = page.getByRole("button", { name: "Add-ons", exact: true });
    if (await packagesNav.isVisible().catch(() => false)) {
      await packagesNav.click();
    }
    await page.getByTestId("package-browser").waitFor({ state: "visible", timeout: 15_000 });

    // The recommended list loads async (server enrich reads the seeded
    // package.json off disk), so allow the same generous timeout the sibling
    // requires-probe spec uses. Wait on the panel's own header control.
    await expect(page.getByTestId("rec-install-all-missing")).toBeVisible({ timeout: 30_000 });

    // Recommended once (change: addons-hub-declutter): an entry installed
    // globally AND active in pi renders only as an installed row — there is no
    // card for it any more, in ANY state. The row (a recommended match, so it
    // sits in the Recommended Extensions sub-group) proves the name fallback
    // still resolved the local checkout.
    const row = page.getByTestId("pkg-row--fixtures-local-pkg-image-fit-extension");
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`rec-remove-${ENTRY_ID}`)).toHaveCount(0);

    // The bug the original change fixed: the entry rendered as Install (treated
    // as not installed) because the name fallback was never applied to
    // activeSources. It must still never offer Install / Activate.
    await expect(page.getByTestId(`rec-install-${ENTRY_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`rec-activate-${ENTRY_ID}`)).toHaveCount(0);
  });
});
