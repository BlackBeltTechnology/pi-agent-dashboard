import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the context-mode settings section (change:
 * add-context-mode-settings-plugin). Covers test-plan F1 (save + reload
 * round-trip) and F2 (invalid input is rejected inline, nothing written).
 *
 * Runs against the REAL harness: the plugin is bundled and default-enabled, and
 * `requires.piExtensions` is a status report, not a gate, so the section renders
 * whether or not the `context-mode` extension is installed in the image. Writes
 * go to the harness's own `~/.pi/context-mode/settings.json`.
 */

const PLUGIN_PATH = "/settings/plugins/context-mode-settings";
const CONFIG_ROUTE = "/api/plugins/context-mode-settings/config";

async function gotoSection(page: Page) {
  await page.goto(PLUGIN_PATH);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("cms-file-path")).toBeVisible({ timeout: 30_000 });
}

async function getFields(page: Page) {
  const res = await page.request.get(CONFIG_ROUTE);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { fields: Record<string, { value: unknown; isDefault: boolean }> }).fields;
}

test.describe("context-mode settings (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    // Start every spec from "no file": an empty full-object PUT is the reset.
    const res = await page.request.put(CONFIG_ROUTE, { data: {} });
    expect(res.ok()).toBe(true);
  });

  test("F1: a saved search window survives a reload and is served by the API", async ({ page }) => {
    await gotoSection(page);
    const input = page.getByTestId("cms-input-search.windowMs");
    await expect(input).toHaveValue("60000");
    await expect(page.getByTestId("cms-default-badge-search.windowMs")).toBeVisible();

    await input.fill("30000");
    await input.blur();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 30_000 });

    await page.reload();
    await expect(page.getByTestId("cms-file-path")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("cms-input-search.windowMs")).toHaveValue("30000");
    await expect(page.getByTestId("cms-default-badge-search.windowMs")).toHaveCount(0);
    expect((await getFields(page))["search.windowMs"]).toMatchObject({ value: 30000, isDefault: false });
  });

  test("F2: 0 in the hard-block field shows an inline error and writes nothing", async ({ page }) => {
    await gotoSection(page);
    const input = page.getByTestId("cms-input-search.blockAfter");
    await input.fill("0");
    await input.blur();
    await expect(page.getByTestId("cms-error-search.blockAfter")).toBeVisible();

    // The Save Bar may offer Save (it ignores plugin validity); the commit must be refused.
    const save = page.getByTestId("save-btn");
    if (await save.isVisible()) await save.click();
    await expect(page.getByTestId("cms-error-search.blockAfter")).toBeVisible();
    expect((await getFields(page))["search.blockAfter"]).toMatchObject({ value: 8, isDefault: true });
  });
});
