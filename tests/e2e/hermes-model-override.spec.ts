import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3: the hermes-memory "Model override" field uses the shared model selector
 * (change: add-context-mode-settings-plugin, test-plan F3). Picks the first
 * model the harness serves, saves, reloads, and checks both the rendered field
 * and the hermes config API.
 */

const PLUGIN_PATH = "/settings/plugins/hermes-memory";
const CONFIG_ROUTE = "/api/plugins/hermes-memory/config";

// Deterministic catalogue (the real route's rows: `id` is `provider/id`). Routed so the
// spec does not depend on which providers a given harness image happens to seed.
const MODELS = {
  object: "list",
  data: [
    { id: "anthropic/claude-sonnet-4", provider: "anthropic", reasoning: true },
    { id: "openai/gpt-4o", provider: "openai", reasoning: false },
  ],
};

test.describe("hermes model override selector (L3)", () => {
  test("F3: pick a model, save, reload — the chosen provider/id persists", async ({ page }) => {
    await page.route("**/api/models*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MODELS) }),
    );
    await gotoDashboard(page);
    await page.goto(PLUGIN_PATH);
    await expect(page.getByTestId("hermes-file-path")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
    });

    const field = page.getByTestId("hermes-input-llmModelOverride");
    await field.scrollIntoViewIfNeeded();
    await field.getByTestId("model-selector-button").click();
    const first = page.getByTestId("model-row").first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await first.click();

    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 30_000 });

    const stored = ((await (await page.request.get(CONFIG_ROUTE)).json()) as {
      fields: { llmModelOverride: { value: unknown; isDefault: boolean } };
    }).fields.llmModelOverride;
    expect(stored.isDefault).toBe(false);
    expect(typeof stored.value).toBe("string");
    expect(String(stored.value)).toContain("/");

    await page.reload();
    await expect(page.getByTestId("hermes-file-path")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("hermes-input-llmModelOverride").getByTestId("model-selector-button")).toContainText(
      String(stored.value).split("/").slice(1).join("/"),
    );

    // Leave the harness file clean for later specs.
    await page.request.put(CONFIG_ROUTE, { data: {} });
  });
});
