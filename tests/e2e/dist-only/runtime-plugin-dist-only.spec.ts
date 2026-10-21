import { expect, test } from "@playwright/test";

// Plain `@playwright/test` is intentional here (like `tests/e2e/identity/`): this project's server is a
// clean-prefix install, not the docker harness the `./fixtures.js` reap/health fixtures are built for.
//
// F18 — a stock (dist-only) install renders a trusted runtime plugin (render half).
// change: decouple-plugins-from-core (test-plan #F18, task 8.139). Runs only under
// `playwright.dist-only.config.ts` (task 8.5): global-setup boots a clean-prefix server with the prebuilt canary
// staged UNTRUSTED, so the Trust click is the trigger. The host browser reaches the server over loopback
// (genuinely local), so the real Trust button grants the hash.
//
// STATUS: written, not yet run — it needs a packed dashboard (QA_DASHBOARD_TARBALL + QA_EXTRA_TARBALLS, or
// QA_DASHBOARD_VERSION) to bootstrap; see playwright.dist-only.config.ts.

const CANARY_ID = "runtime-canary";

test.use({ baseURL: process.env.PW_DIST_ONLY_URL });

test("F18: on a dist-only install, granting trust makes the runtime plugin's claim appear without a reload", async ({ page }) => {
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });

  await page.goto("/settings/plugins");
  const row = page.getByTestId(`plugin-row-${CANARY_ID}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  // Refused visibly, with the Trust action; no claim yet.
  await expect(page.getByTestId(`plugin-client-refused-${CANARY_ID}`)).toContainText("untrusted");
  await expect(page.getByTestId("canary-settings")).toHaveCount(0);
  const loadsBefore = loads;

  await page.getByTestId(`plugin-trust-${CANARY_ID}`).click();

  // After `plugins_changed` the runtime loader registers the claim; open the plugin page in the SAME document.
  await expect(page.getByTestId(`plugin-revoke-${CANARY_ID}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`plugin-expand-${CANARY_ID}`).click();
  await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
  expect(loads).toBe(loadsBefore);
});
