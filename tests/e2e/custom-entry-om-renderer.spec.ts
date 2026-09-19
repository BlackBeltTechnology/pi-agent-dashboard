import {
  OM_ENTRY_TAIL,
  OM_OBSERVATION_ALPHA,
  OM_OBSERVATION_BETA,
} from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Rendered-UI behaviour of the blackhole `custom-entry-renderer` claim against
 * a live session (browser E2E, test-plan #F15; change:
 * add-custom-entry-renderer-slot).
 *
 * The `[[faux:om-entry]]` scenario drives the REAL `pi.appendEntry` path with
 * `om.observations.recorded`, so the blackhole plugin owns the row. The `om.*`
 * `memory` event group ships HIDDEN, so the spec first enables it through the
 * session's ⚙ View popover — the surface a user actually reaches.
 *
 * Promise: an `om.*` row no longer renders as a JSON blob through the generic
 * fallback; its collapsed line is a labelled summary and expanding it shows the
 * observation records as discrete items fetched from the on-disk payload.
 */
test.setTimeout(180_000);

test.describe("om custom entries render through the plugin", () => {
  test("#F15 collapsed line is a labelled summary; expansion shows discrete records", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:om-entry]] go");
    await expect(page.getByText(OM_ENTRY_TAIL).first()).toBeVisible({ timeout: 60_000 });

    // Enable the `memory` event group (default HIDDEN) through the View popover.
    await expect(async () => {
      await page.getByRole("button", { name: /view/i }).first().click();
      const popover = page.locator('[data-testid="chat-view-popover"]');
      await popover.waitFor({ state: "visible", timeout: 15_000 });
      const box = popover.getByRole("checkbox", { name: "Memory telemetry" });
      await box.check();
      await expect(box).toBeChecked();
    }).toPass({ timeout: 20_000 });
    await page.keyboard.press("Escape");

    // The claimed `om` row is TRANSPARENT to burst formation (design D7), so it
    // is ABSORBED into the tool burst rather than emitted at top level. The
    // burst renders collapsed by default — expand every e2e_custom_entry burst.
    const burstHeaders = page
      .locator('[data-testid="tool-burst-group"]', { hasText: "e2e_custom_entry" })
      .getByTestId("tool-burst-header");
    await expect(burstHeaders.first()).toBeVisible({ timeout: 15_000 });
    const n = await burstHeaders.count();
    for (let i = 0; i < n; i++) await burstHeaders.nth(i).click();

    const row = page.locator('[data-testid="om-entry-card"]').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Collapsed line: the plugin's labelled summary, NOT a JSON blob.
    await expect(row.getByTestId("om-entry-label")).toHaveText("Observations recorded");
    await expect(row.getByTestId("om-entry-count")).toHaveText("2");
    // The generic fallback card did NOT render for the claimed type.
    await expect(page.locator('[data-testid="custom-entry-card"]')).toHaveCount(0);

    // Expand → discrete observation records from the on-demand payload.
    await row.getByTestId("om-entry-toggle").click();
    await expect(row.getByTestId("om-entry-body")).toBeVisible();
    const records = row.getByTestId("om-entry-record");
    await expect(records).toHaveCount(2);
    await expect(records.nth(0)).toHaveText(OM_OBSERVATION_ALPHA);
    await expect(records.nth(1)).toHaveText(OM_OBSERVATION_BETA);
  });
});
