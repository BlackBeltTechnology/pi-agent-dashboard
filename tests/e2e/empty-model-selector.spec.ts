import { expect, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — the model selector stays openable and its empty-state recovery
 * link has a real destination (change: open-empty-model-selector).
 *
 * The genuinely-empty catalogue ("no provider configured after session start")
 * cannot be forced deterministically in the docker harness: the harness always
 * seeds a populated model registry (same limitation
 * `list-models-registry-ready.spec.ts` documents for its V.3 spawn-before-
 * hydration race). The empty-state body, the `awaitingRefresh` gate, the
 * reopen-to-retry path, and the thin partial-failure footer are therefore
 * unit-proven exhaustively in `ModelSelector.test.tsx` (20 cases).
 *
 * What this spec proves in the real DOM (the two slices the harness CAN drive):
 *  1. The trigger is openable and opens the dropdown — the core regression
 *     guard for removing the `disabled={!hasModels}` gate (task 2.1). Before the
 *     change an empty catalogue rendered a dead button; a populated one still
 *     opens, so this guards the shared openable-trigger path.
 *  2. `/settings/providers` — the recovery link's navigation target — renders
 *     the LLM Providers surface. The unit tests prove the link fires the
 *     navigation callback; this proves the callback's destination is a real,
 *     rendering route (so the empty-state recovery is not a dead link).
 */

test.describe("open-empty-model-selector (L3)", () => {
  test("model selector trigger is openable and opens the dropdown", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });

    const trigger = page.getByTestId("model-selector-button");
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    // Core change: the composer trigger is never rendered `disabled`.
    await expect(trigger).toBeEnabled();

    await trigger.click();
    await expect(page.getByTestId("model-dropdown")).toBeVisible({ timeout: 10_000 });
  });

  test("the recovery link destination (/settings/providers) renders", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/providers");
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
    // The empty-state `⚙ Open provider settings` link navigates here; prove the
    // destination is a real rendering surface, not a dead route.
    await expect(
      page.getByTestId("settings-content").getByText("LLM Providers", { exact: false }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
