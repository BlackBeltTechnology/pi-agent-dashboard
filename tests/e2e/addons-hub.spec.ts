import { expect, test } from "./fixtures.js";
import { byTestId, gotoDashboard } from "./helpers/index.js";

/**
 * Add-ons hub (change: addons-hub-declutter).
 *
 * F5 — the legacy `/settings/packages` URL replace-redirects to
 *      `/settings/add-ons`; the rail shows `ADD-ONS › Add-ons` active, the
 *      heading reads `Add-ons`, and no dashboard-managed bridge row
 *      (`index.ts`) renders in the installed list.
 * F4 — at a 375px viewport the Plugins rail entry is collapsed by default with
 *      a child count, expands in place without navigating, and the choice
 *      survives a reload.
 *
 * The dashboard port comes from the Playwright baseURL (docker/test-up.sh →
 * .pi-test-harness.json); nothing is hardcoded here.
 */
test.describe("Add-ons hub", () => {
  test("F5: /settings/packages lands on the Add-ons page without bridge rows", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/packages");

    await expect(page).toHaveURL(/\/settings\/add-ons$/, { timeout: 15_000 });
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });

    const group = page.getByTestId("settings-nav-group-add-ons");
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Add-ons", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 2, name: "Add-ons" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pi Ecosystem", { exact: true })).toHaveCount(0);

    // Dashboard-managed bridge entries (`<plugin>/src/bridge/index.ts`) are hidden.
    await expect(page.getByTestId("addons-filter")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("index.ts", { exact: true })).toHaveCount(0);
  });

  test("explainer is expanded on first load, collapsed after dismiss + reload; no recommended entry is both row and card", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/add-ons");
    const toggle = page.getByTestId("addons-explainer-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await page.reload();
    await expect(page.getByTestId("addons-explainer-toggle")).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
    await page.getByTestId("addons-explainer-link").click();
    await expect(page.getByTestId("addons-explainer-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("addons-explainer-toggle")).toBeFocused();

    // Recommended once: an entry with an installed row has no card in the Discover tab.
    await page.getByTestId("addons-tab-installed").waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.locator("[data-testid^='addon-row-']").first()).toBeVisible({ timeout: 30_000 });
    const rowNames = await page
      .locator("[data-testid^='addon-row-']")
      .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("addon-row-", "")));
    await page.getByTestId("addons-tab-discover").click();
    await page.getByTestId("package-browser").waitFor({ state: "visible", timeout: 30_000 });
    const cardIds = await page
      .locator("[data-testid^='rec-remove-']")
      .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("rec-remove-", "")));
    // A card with a Remove action is an installed entry; installed-globally ones must not be cards.
    // (Folder-only installs legitimately keep a card, hence the harness has none.)
    expect(cardIds.filter((id) => rowNames.some((r) => r.includes(id)))).toEqual([]);
  });

  test("F4: Plugins subtree is collapsed by default at 375px, expands in place, persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoDashboard(page);
    await page.goto("/settings/general");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });

    const toggle = page.getByTestId("nav-plugins-toggle");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText(/\d+/);
    await expect(page.locator("[data-testid^='nav-plugin-']:not([data-testid^='nav-plugin-status-'])")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(page.locator("[data-testid^='nav-plugin-']:not([data-testid^='nav-plugin-status-'])").first()).toBeVisible();

    await page.reload();
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    await expect(page.getByTestId("nav-plugins-toggle")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
  });
  // See change: addons-hub-feature-catalog (test-plan #F6, #F7).
  test("F6: Goal off and on round-trips through the hub switch and the settings entry", async ({ page }) => {
    await gotoDashboard(page);
    const catalog = await page.request.get("/api/addons/catalog");
    const features = ((await catalog.json()) as { features: Array<{ id: string; packages: unknown[] }> }).features;
    const goal = features.find((f) => f.id === "plugin:goal");
    test.skip(!goal || goal.packages.length === 0, "Goal's pi-goal-hermes package is not installed in this harness");

    await page.goto("/settings/add-ons");
    const sw = page.getByTestId("addon-switch-plugin:goal");
    await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await sw.click();
    await page.getByTestId("addon-toggle-confirm-button").click();
    await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId("addon-switch-plugin:goal")).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
    const off = ((await (await page.request.get("/api/addons/catalog")).json()) as { features: Array<{ id: string; state: string }> }).features;
    expect(off.find((f) => f.id === "plugin:goal")?.state).toBe("off");

    await page.getByTestId("addon-switch-plugin:goal").click();
    await expect(page.getByTestId("addon-switch-plugin:goal")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  });

  test("F7: the selected tab survives a reload", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/add-ons");
    await page.getByTestId("addons-tab-discover").click();
    await expect(page).toHaveURL(/\?tab=discover/);
    await page.reload();
    await expect(page.getByTestId("addons-tab-discover")).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect(page.getByTestId("package-browser")).toBeVisible({ timeout: 30_000 });
  });
});
