import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — the roles plugin page is PROMOTED into the first Settings nav group,
 * `Models`, as "Model roles"; placement only, URL stays `/settings/plugins/roles`.
 * Covers test-plan rows F11–F13 of change promote-model-roles-settings.
 *
 * Harness glue from `plugin-settings-pages.spec.ts` (rail navigation) and
 * `roles-custom.spec.ts` (custom-role editing needs a live session: the roles
 * list and the model catalogue reach the browser through it). The dashboard
 * port comes from `.pi-test-harness.json` via the Playwright baseURL — never
 * hardcode :18000.
 */

const ROLE = "e2e-role";

async function gotoSettings(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

test.describe("Model roles promotion (L3)", () => {
  test("F11: desktop — Models is first; Model roles opens the plugin URL; deep link renders the same", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The role rows need roles_list, which only reaches the browser through a
    // live session (App.tsx request_roles).
    await spawnFreshGitSession(page);
    await gotoSettings(page, "/settings");
    const rail = page.getByTestId("settings-nav-rail");

    const firstGroup = rail.locator("[data-testid^='settings-nav-group-']").first();
    await expect(firstGroup).toHaveAttribute("data-testid", "settings-nav-group-models");
    await expect(rail.getByTestId("settings-nav-group-label-models")).toHaveText(/Models/i);

    await rail.getByTestId("nav-promoted-roles").click();
    await expect(page).toHaveURL(/\/settings\/plugins\/roles$/);
    await expect(page.getByTestId("plugin-page-title")).toHaveText("Model roles");
    await expect(rail.getByTestId("nav-promoted-roles")).toHaveAttribute("aria-current", "page");
    await expect(rail.locator("[aria-current='page']")).toHaveCount(1);
    await expect(page.getByTestId("roles-row-planning")).toBeVisible({ timeout: 30_000 });

    const pointer = rail.getByTestId("nav-plugin-pointer-roles");
    await expect(pointer).toContainText("Roles");
    await expect(pointer).toContainText("Models");

    await page.goto("/settings/plugins/roles");
    await expect(page.getByTestId("plugin-page-title")).toHaveText("Model roles", { timeout: 20_000 });
    await expect(page.getByTestId("roles-row-planning")).toBeVisible({ timeout: 30_000 });
  });

  test("F12: mobile — the nav strip starts with Providers, Model roles", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoDashboard(page);
    await gotoSettings(page, "/settings");
    const rail = page.getByTestId("settings-nav-rail");
    const entries = rail.locator("button");
    await expect(entries.nth(0)).toHaveText(/Providers/);
    await expect(entries.nth(1)).toHaveText(/Model roles/);

    await entries.nth(1).click();
    await expect(page).toHaveURL(/\/settings\/plugins\/roles$/);
    const content = page.getByTestId("settings-content");
    await expect(content).toBeVisible();
    const box = await content.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
  });

  test("F13: a role edit names Models › Model roles in the Save Bar and persists", async ({ page }) => {
    test.setTimeout(180_000);
    page.on("dialog", (d) => d.accept());
    // A live session carries roles_list + the model catalogue to the browser.
    await spawnFreshGitSession(page);
    await gotoSettings(page, "/settings/plugins/roles");
    await expect(page.getByTestId("roles-group-custom")).toBeVisible({ timeout: 30_000 });

    // Start clean: a leftover role from an aborted run would make the add a no-op.
    const leftover = page.getByTestId(`roles-row-${ROLE}-remove`);
    if (await leftover.isVisible()) await leftover.click();
    await expect(page.getByTestId(`roles-row-${ROLE}`)).toHaveCount(0);

    try {
      await page.getByTestId("roles-add-custom").click();
      await page.getByTestId("roles-add-custom-input").fill(ROLE);
      await page.getByTestId("roles-add-custom-confirm").click();
      const picker = page.getByTestId("roles-model-picker");
      await expect(picker).toBeVisible({ timeout: 15_000 });
      await picker.getByTestId("model-selector-button").first().click();
      const row = page.getByTestId("model-row").first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      // The exact ref that Save will persist ("saves <provider>/<id>[:level]").
      const echo = page.getByTestId("roles-ref-echo");
      await expect(echo).not.toHaveText(/—\s*$/);
      const stagedRef = ((await echo.textContent()) ?? "").trim();

      const chip = page.getByTestId("save-bar-page-plugins/roles");
      await expect(chip).toHaveText(/Models › Model roles/);
      await expect(page.getByTestId("settings-nav-rail").getByTestId("nav-promoted-roles").getByTestId("nav-dirty-plugins/roles")).toBeVisible();

      await page.getByTestId("save-btn").click();
      await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

      await page.reload();
      const pill = page.getByTestId(`roles-row-${ROLE}`);
      await expect(pill).toBeVisible({ timeout: 30_000 });
      await expect(pill).not.toContainText("+ Add model");
      // Persisted value == the staged one, not merely "some model".
      await pill.click();
      await expect(page.getByTestId("roles-ref-echo")).toHaveText(stagedRef);
    } finally {
      // Leave the shared container's providers.json as we found it.
      const remove = page.getByTestId(`roles-row-${ROLE}-remove`);
      if (await remove.isVisible().catch(() => false)) await remove.click();
    }
  });
});
