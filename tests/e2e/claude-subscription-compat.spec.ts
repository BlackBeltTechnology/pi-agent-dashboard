import { expect, test } from "./fixtures.js";
import { gotoDashboard, openAddPicker, openProvidersSettings, providerStatusRow, routeProviderData } from "./helpers/index.js";

/**
 * L3 browser behaviour for the Claude subscription compat switch
 * (change: retire-anthropic-messages-bridge, test-plan #F1, #F3).
 *
 * The compat preference route is REAL (harness server, preferences.json);
 * only the provider-auth status / flow reads are staged with `page.route`,
 * mirroring redesign-provider-add-flow.spec.ts (F1) and
 * first-run-skip-providers.spec.ts (Landing).
 */

const COMPAT = "/api/preferences/claude-subscription-compat";

async function setCompat(request: import("@playwright/test").APIRequestContext, value: boolean): Promise<void> {
  const res = await request.patch(COMPAT, { data: { value } });
  expect(res.ok()).toBeTruthy();
}

const connectedAnthropic = () =>
  providerStatusRow({
    id: "anthropic",
    name: "Anthropic",
    authenticated: true,
    configured: true,
    expires: Date.now() + 30 * 86_400_000,
  });

test.describe("Claude subscription compat (L3)", () => {
  test.beforeEach(async ({ request }) => {
    await setCompat(request, false);
  });
  test.afterEach(async ({ request }) => {
    await setCompat(request, false).catch(() => {});
  });

  // ── F1 — sign-in prompt → Turn on → row shows on, survives reload ────────
  test("F1: an anthropic sign-in asks to turn compat on; Turn on persists; no install UI", async ({ page }) => {
    const data = routeProviderData(page, { statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })] });
    const flowId = "flow-e2e-compat";
    let complete = false;
    await page.route("**/api/provider-auth/start", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ flowId, provider: "anthropic", status: "pending", authUrl: "https://example.com/oauth/authorize" }),
      }),
    );
    await page.route("**/api/provider-auth/flow/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          complete
            ? { flowId, provider: "anthropic", status: "complete" }
            : { flowId, provider: "anthropic", status: "pending", authUrl: "https://example.com/oauth/authorize" },
        ),
      }),
    );
    await openProvidersSettings(page);

    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    complete = true;
    data.serveStatuses([connectedAnthropic()]);

    await expect(page.getByTestId("claude-compat-prompt")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("claude-compat-prompt-turn-on").click();
    await expect(page.getByTestId("claude-compat-prompt")).toHaveCount(0);

    const sw = page.getByTestId("claude-compat-switch");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/Installing/)).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("claude-compat-switch")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    expect(((await (await page.request.get(COMPAT)).json()) as { claudeSubscriptionCompat: boolean }).claudeSubscriptionCompat).toBe(true);
  });

  // ── F3 — Landing Step ① Turn on ──────────────────────────────────────────
  test("F3: Landing shows the extra-usage notice while off; Turn on hides it and the row shows on", async ({ page }) => {
    routeProviderData(page, { statuses: [connectedAnthropic()] });
    await gotoDashboard(page);

    const notice = page.getByTestId("onboarding-step-1-compat-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("onboarding-step-1-compat-turn-on").click();
    await expect(notice).toHaveCount(0);

    await openProvidersSettings(page);
    await expect(page.getByTestId("claude-compat-switch")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  });
});
