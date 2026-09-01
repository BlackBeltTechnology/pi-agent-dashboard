import { expect, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — capability provenance renders honestly in the real DOM
 * (change: fix-custom-provider-model-metadata, test-plan F1/F2).
 *
 * Harness limitation, stated rather than faked: a metadata-RICH custom provider
 * cannot be seeded here. `providers.json` in the harness carries only the faux
 * role-preset, and a custom provider would need a reachable `/v1/models`
 * advertising `context_length`/`capabilities` — there is no such endpoint in
 * the image (same class of limitation `empty-model-selector.spec.ts` documents
 * for the genuinely-empty catalogue). The three provenance branches
 * (`"catalog"` / `"endpoint"` / `"fallback"` / absent) are therefore proven
 * exhaustively in `ModelSelector.test.tsx` (F3), and the end-to-end value flow
 * is proven at L1 across both discovery surfaces.
 *
 * What this spec proves in the real DOM (the slices the harness CAN drive):
 *  1. The rendered selector reports each row's capability treatment through
 *     real title text — so "confirmed" and "uncertain" are distinguishable by
 *     a user, not just by a unit assertion.
 *  2. A confirmed-provenance row (the harness's registered models) carries NO
 *     uncertainty marker. Before this change an endpoint-sourced model would
 *     have been stamped `"fallback"` and rendered with `?` markers; this is the
 *     rendered-DOM guard that confirmed capability stays unmarked.
 */

test.describe("model-selector capability provenance (L3)", () => {
  test("confirmed-provenance rows render without an uncertainty marker", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("model-selector-button").click();
    await expect(page.getByTestId("model-dropdown")).toBeVisible({ timeout: 10_000 });

    const rows = page.getByTestId("model-row");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    // Every row the harness serves carries verified pi-ai/registered metadata,
    // i.e. confirmed provenance. None may render the uncertain treatment.
    const uncertain = await page.locator('[data-testid="model-row"] [title*="assumed"]').count();
    expect(uncertain).toBe(0);
  });

  test("capability treatment is expressed through readable title text", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("model-selector-button").click();
    await expect(page.getByTestId("model-dropdown")).toBeVisible({ timeout: 10_000 });

    const rows = page.getByTestId("model-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Any capability icon that IS rendered must carry a provenance-bearing
    // title — the mechanism the endpoint tier reuses. A row with no capability
    // fields legitimately renders none, so this asserts the vocabulary rather
    // than a fixed count.
    const titles = await page
      .locator('[data-testid="model-row"] [title]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
    for (const title of titles.filter((t) => /Reasoning|Vision/i.test(t))) {
      expect(title).toMatch(/confirmed|assumed|unknown/i);
    }
  });
});
