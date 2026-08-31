import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for Settings ▸ Developer ▸ Diagnostics after the
 * spawn-runtime resolution ladder (change: unify-pi-runtime-identity).
 * Covers test-plan row F1 (task 9.18).
 *
 * The docker harness is the ideal F1 fixture by construction: a single
 * in-image Node, a coherent shared extension tree, one dashboard instance.
 * The ladder therefore MUST converge on the image Node, and the ABI
 * guard rail MUST find nothing to reconcile:
 *
 *   - the resolved spawn-runtime row is rendered with the Node version and
 *     the ladder source label (F1's "version + source label");
 *   - zero `ABI mismatch:` rows render anywhere in the report.
 *
 * The harness port comes from the Playwright baseURL, derived by
 * docker/test-up.sh into .pi-test-harness.json — never hardcoded.
 */

test.describe("diagnostics spawn-runtime visibility (L3, test-plan F1)", () => {
  test("resolved runtime row renders with version + source; zero ABI-mismatch rows", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/settings/developer");
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });

    // The Diagnostics section fetches /api/doctor on mount; wait for the
    // runtime section to render before asserting row content.
    const runtimeSection = page.getByTestId("diagnostics-section-runtime");
    await expect(runtimeSection).toBeVisible({ timeout: 30_000 });

    // F1: the spawn-runtime row is visible with version + source label.
    // Row message shape (doctor-core): "pi sessions spawn <binary> — Node
    // <version> (ABI <abi>, via <rung>[/<via>])" — the rung is the source
    // label (user / override / selection / managed / bundled / execPath).
    const runtimeSectionRows = runtimeSection.locator("> .rounded > div");
    const spawnRow = runtimeSectionRows.filter({ hasText: "Spawn runtime (resolved)" });
    await expect(spawnRow).toHaveCount(1, { timeout: 15_000 });
    await expect(spawnRow).toBeVisible();
    await expect(spawnRow).toContainText(/Node v\d+\.\d+\.\d+/);
    await expect(spawnRow).toContainText(
      /via (override|selection|user|managed|bundled|execPath)/,
    );

    // F1: a coherent single-Node machine produces zero ABI-mismatch rows —
    // scan the WHOLE rendered report, not just one section.
    await expect(page.getByText(/^ABI mismatch:/)).toHaveCount(0);
  });
});
