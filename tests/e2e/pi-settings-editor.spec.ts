import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the pi settings editor + default-model mirror
 * (change: edit-pi-agent-settings). Covers test-plan rows F13 and F14.
 *
 * F13 drives the Form mode in the real UI and reads the result back through
 * `GET /api/pi-settings`. F14 selects a Default model and asserts pi's own
 * `~/.pi/agent/settings.json` (read via the same API) now carries the split
 * provider/id. NOTE: the harness seeds pi's `defaultProvider: "faux"`
 * (spec `faux-model-integration-tests`); F14 deliberately rewrites it.
 *
 * `GET /api/models` is stubbed so the catalogue does not depend on harness
 * credentials. The dashboard port comes from .pi-test-harness.json via the
 * Playwright baseURL — never hardcode :18000.
 */

const CATALOGUE = {
  object: "list",
  data: [{ id: "openai/gpt-5-e2e", provider: "openai", input: ["text"], contextWindow: 400000 }],
};

async function openSessionsSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByTestId("pi-settings-section")).toBeVisible({ timeout: 20_000 });
}

async function piSettings(page: Page) {
  const res = await page.request.get("/api/pi-settings");
  expect(res.status()).toBe(200);
  return (await res.json()) as { settings: Record<string, unknown>; raw: string; etag: string };
}

test.describe("pi settings editor", () => {
  // test-plan #F13
  test("a Form edit saves through the unified Save and shows in JSON mode", async ({ page }) => {
    await openSessionsSettings(page);

    await page.getByTestId("pi-settings-field-steeringMode").selectOption("all");
    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    expect((await piSettings(page)).settings.steeringMode).toBe("all");

    // Not dirty any more, so switching mode does not prompt; JSON shows the value.
    await page.getByTestId("pi-settings-mode-json").click();
    await expect(page.getByTestId("pi-settings-switch-prompt")).toBeHidden();
    await expect(page.getByTestId("pi-settings-section")).toContainText('"steeringMode": "all"', { timeout: 20_000 });
  });

  // test-plan #F14
  test("saving a Default model mirrors it into pi's settings.json", async ({ page }) => {
    await page.route("**/api/models", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOGUE) }),
    );
    await openSessionsSettings(page);

    const selector = page.getByTestId("model-selector").first();
    await selector.getByTestId("model-selector-button").click();
    await selector.getByTestId("model-row").filter({ hasText: "gpt-5-e2e" }).first().click();
    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    await expect
      .poll(async () => (await piSettings(page)).settings, { timeout: 20_000 })
      .toMatchObject({ defaultProvider: "openai", defaultModel: "gpt-5-e2e" });
    // pi now matches the dashboard default, so no drift action is offered.
    await expect(page.getByTestId("pi-settings-sync-defaults")).toBeHidden();
  });
});
