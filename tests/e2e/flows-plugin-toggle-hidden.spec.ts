import { expect, test } from "./fixtures.js";
import { chipRun, expandSummary, pickFlow, waitForFlowsChip } from "./helpers/flows-chip.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * A disabled flows plugin hides persisted runs: with the plugin off, a reload
 * renders no flow panel, FLOWS subcard, summary or agent detail, and the
 * persisted `flow-event` entries never fall back to generic custom cards
 * (declared types of a disabled plugin form the hide-only set, G5).
 * See change: update-flows-plugin (D3; test-plan F6; exemplar
 * subagents-plugin-toggle-render.spec.ts).
 */
test.describe("flows plugin disabled hides persisted runs (L3)", () => {
  const toggle = (page: import("@playwright/test").Page, enabled: boolean) =>
    page.request.post("/api/plugins/flows/toggle", { data: { enabled } });

  test("F6: plugin off → reload → no flow UI and no custom card for the flow entries", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      const card = await spawnFreshGitSession(page);
      const sid = (await card.getAttribute("data-session-id")) ?? "";
      await card.click();
      await sendPrompt(page, "[[faux:plain-text]] go");
      await expect(page.getByText(/plain/i).first()).toBeVisible({ timeout: 60_000 });
      await waitForFlowsChip(page);
      await chipRun(page).click();
      await pickFlow(page, "synthetic");
      await byTestId(page, "flowLaunchRun").click();
      await expandSummary(page);

      expect((await toggle(page, false)).ok()).toBeTruthy();
      await page.reload();
      await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
      await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`).click();
      // Chat history is back (replay ran) …
      await expect(page.getByText(/plain/i).first()).toBeVisible({ timeout: 60_000 });
      // … but no flow surface and no generic card for the persisted entries.
      await expect(page.getByTestId("flow-dashboard")).toHaveCount(0);
      await expect(page.getByTestId("flow-summary-panel-toggle")).toHaveCount(0);
      await expect(page.getByTestId("flows-context-group")).toHaveCount(0);
      await expect(page.locator('[data-testid="custom-entry-card"]', { hasText: "flow-event" })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await toggle(page, true).catch(() => undefined);
    }
  });
});
