import { expect, type Page, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — favorites are inherited by every `ModelSelector` that renders
 * inside `ModelConfigProvider`, so a star set on one surface (Settings →
 * Sessions Default Model) is the SAME server-persisted favorite the session
 * composer shows (change: model-picker-everywhere-favorites, test-plan F3).
 *
 * Harness glue from `settings-default-model-catalogue.spec.ts` (Settings →
 * Sessions nav) + `empty-model-selector.spec.ts` (composer selector). The
 * dashboard port comes from `.pi-test-harness.json` via the Playwright baseURL —
 * never hardcode :18000.
 *
 * `GET /api/models` is route-stubbed so the Settings Default Model picker
 * deterministically offers the seeded `faux/faux-1`; the composer side reads the
 * real session `models_list` (seeded by `PI_E2E_SEED=1`). The star click and the
 * reload both go through the real server-persistence path.
 */

const MODEL_LABEL = "faux/faux-1";

async function stubCatalogue(page: Page) {
  await page.route("**/api/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ object: "list", data: [{ id: MODEL_LABEL, provider: "faux" }] }),
    }),
  );
}

test.describe("model-picker-everywhere-favorites cross-surface (L3)", () => {
  test.setTimeout(120_000);

  test("a star set in Settings is pressed in the composer and survives reload", async ({ page }) => {
    await stubCatalogue(page);

    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    // ── Settings → Sessions Default Model picker ──────────────────────────
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Sessions", exact: true }).click();
    await expect(page.getByTestId("default-model-catalogue-loading")).toBeHidden({ timeout: 20_000 });

    await page.getByTestId("settings-content").getByTestId("model-selector-button").first().click();
    const settingsRow = page.getByTestId("model-row").filter({ hasText: MODEL_LABEL }).first();
    await expect(settingsRow).toBeVisible({ timeout: 10_000 });

    // The Settings picker now SHOWS star toggles at all (it used to render
    // inert outline stars) — and they are wired to the context handler.
    const settingsStar = settingsRow.getByTestId("model-fav-toggle");
    await expect(settingsStar).toBeVisible();
    // Normalize to unfavorited first, then favorite — every run exercises the
    // toggle write + persistence path regardless of prior harness state.
    if ((await settingsStar.getAttribute("aria-pressed")) === "true") {
      await settingsStar.click();
      await expect(settingsStar).toHaveAttribute("aria-pressed", "false");
    }
    await settingsStar.click();
    await expect(settingsStar).toHaveAttribute("aria-pressed", "true");

    // ── Session composer: the same favorite reads pressed ─────────────────
    await page.goto(`/session/${sessionId}`);
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("composer-root").getByTestId("model-selector-button").first().click();
    const composerRow = page.getByTestId("model-row").filter({ hasText: MODEL_LABEL }).first();
    await expect(composerRow).toBeVisible({ timeout: 15_000 });
    await expect(composerRow.getByTestId("model-fav-toggle")).toHaveAttribute("aria-pressed", "true");

    // ── Reload: favorites are server-persisted, not component state ───────
    await page.reload();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("composer-root").getByTestId("model-selector-button").first().click();
    const reloadedRow = page.getByTestId("model-row").filter({ hasText: MODEL_LABEL }).first();
    await expect(reloadedRow).toBeVisible({ timeout: 15_000 });
    await expect(reloadedRow.getByTestId("model-fav-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});
