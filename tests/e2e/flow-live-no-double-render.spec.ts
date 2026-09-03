import { expect, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Live flow-event non-double-render (browser E2E, test-plan #F1).
 *
 * During a LIVE pi-flows run, pi-flows appends `customType: "flow-event"`
 * entries to the session AND the bridge forwards the flow events themselves.
 * The dedicated flow cards must be the ONLY rendering — the generic
 * `custom_entry` forward added by render-inline-reasoning-and-custom-entries
 * explicitly excludes `flow-event`, and this spec proves it at L3: zero
 * generic custom cards while a real flow runs.
 *
 * Harness: the managed container boots with the pi-flows engine loaded and a
 * synthetic 2-agent flow under /fixtures/sample-git/.pi/flows/flows/e2e/
 * (same substrate as flow-roundtrip.spec.ts).
 */
test.describe("live flow — dedicated flow card only", () => {
  test("#F1 a live flow renders flow cards and ZERO generic custom cards", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Launch the synthetic flow (availability gate: launcher appears once
    // pi-flows' flows_list arrives).
    const runFlow = card.getByRole("button", { name: /run flow/i });
    await expect(runFlow).toBeVisible({ timeout: 60_000 });
    await runFlow.click();

    const search = page.getByPlaceholder("Search flows...");
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("synthetic");
    await page.getByText("synthetic", { exact: false }).first().click();
    await page.getByTestId("flowLaunchRun").click();

    // The flow actually RAN: its agents resolved to the faux model.
    await expect(page.getByText("faux/faux-1").first()).toBeVisible({ timeout: 60_000 });

    // THE INVARIANT: across the whole live run, not one generic custom card
    // rendered for the flow-event entries (they would double-render next to
    // the dedicated flow cards).
    await expect(page.locator('[data-testid="custom-entry-card"]')).toHaveCount(0);

    // The flow reaches a terminal state (same completion poll as
    // flow-roundtrip) — the assertion holds over the FULL run, not a moment.
    await expect
      .poll(async () => (await card.textContent()) ?? "", { timeout: 60_000 })
      .toMatch(/success|2\/2/i);
    await expect(page.locator('[data-testid="custom-entry-card"]')).toHaveCount(0);
  });
});
