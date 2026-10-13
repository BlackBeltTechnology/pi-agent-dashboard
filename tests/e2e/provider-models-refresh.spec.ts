import { expect, test } from "./fixtures.js";
import { openProvidersSettings, routeProviderData } from "./helpers/index.js";

/**
 * L3: Settings ▸ Providers custom-endpoint row "Refresh models" control
 * (change: add-provider-models-refresh, test-plan #F6). Reads are staged with
 * `page.route` (cf. redesign-providers-list.spec.ts); the refresh POST answers
 * what the real server returns after re-probing the endpoint. The server and
 * bridge halves are L1 (`provider-routes-refresh`, `provider-register-reload`).
 */
test.describe("add-provider-models-refresh — Refresh models (L3)", () => {
  test("F6: the row pill converges to the refreshed model count", async ({ page }) => {
    routeProviderData(page, {
      providers: { "edge-proxy": { baseUrl: "http://localhost:9000/v1", apiKey: "***", api: "openai-completions" } },
      health: { "edge-proxy": { ok: true, status: 200, modelCount: 3, testedAt: Date.now() } },
    });
    let refreshCalls = 0;
    await page.route("**/api/providers/edge-proxy/refresh", (route) => {
      refreshCalls++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, health: { ok: true, status: 200, modelCount: 9, testedAt: Date.now() } }),
      });
    });

    await openProvidersSettings(page);
    const row = page.locator('[data-testid="provider-row"][data-row-id="edge-proxy"]');
    const pill = row.getByTestId("health-pill");
    await expect(pill).toContainText("3 models");

    const button = row.getByTestId("provider-refresh-models");
    await button.click();

    await expect(pill).toContainText("9 models");
    await expect(button).toBeEnabled();
    expect(refreshCalls).toBe(1);
  });
});
