import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the session-independent Default Model catalogue
 * (change: settings-default-model-without-session). Covers test-plan row F4.
 *
 * The bug this guards is exactly a zero-session one: the picker used to be a
 * union over per-session `models_list` pushes, so with nothing connected it was
 * empty and the machine-wide setting could not be set at all. The harness runs
 * with no pi session attached, which IS that state.
 *
 * `GET /api/models` is served from a route interception so the assertion does
 * not depend on which credentials the harness container happens to hold; the
 * SAVE and the reload go through the real `/api/config` persistence path.
 *
 * Harness glue copied from settings-field-descriptions.spec.ts. The dashboard
 * port comes from .pi-test-harness.json via the Playwright baseURL — never
 * hardcode :18000.
 */

const CATALOGUE = {
  object: "list",
  data: [
    { id: "openai/gpt-5-e2e", provider: "openai", input: ["text"], contextWindow: 400000 },
    { id: "anthropic/claude-e2e", provider: "anthropic", input: ["text", "image"] },
  ],
};

async function stubCatalogue(page: Page) {
  await page.route("**/api/models", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOGUE) }),
  );
}

async function openSessionsSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Sessions", exact: true }).click();
}

test.describe("settings default model catalogue", () => {
  // test-plan #F4
  test("the Default Model control is populated and savable with no session connected", async ({ page }) => {
    await stubCatalogue(page);
    await openSessionsSettings(page);

    // No session is connected, yet the control offers the catalogue.
    await expect(page.getByTestId("default-model-catalogue-loading")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("default-model-catalogue-unavailable")).toBeHidden();

    const selector = page.getByTestId("model-selector").first();
    await selector.getByTestId("model-selector-button").click();
    const row = selector.getByTestId("model-row").filter({ hasText: "gpt-5-e2e" }).first();
    await expect(row).toBeVisible();
    await row.click();

    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    // The saved value survives a reload.
    await openSessionsSettings(page);
    await expect(
      page.getByTestId("model-selector").first().getByTestId("model-selector-button"),
    ).toContainText("gpt-5-e2e", { timeout: 20_000 });
  });

  // Registry-unavailable is a distinct state from an empty catalogue, and it
  // must be visible WITHOUT opening the selector popover (which is disabled
  // while the list is empty — the reason the callout is a sibling).
  test("a failing catalogue renders the sibling callout", async ({ page }) => {
    await page.route("**/api/models", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "MODEL_PROXY_RUNTIME_MISSING" }),
      }),
    );
    await openSessionsSettings(page);
    await expect(page.getByTestId("default-model-catalogue-unavailable")).toBeVisible({ timeout: 20_000 });
  });
});
