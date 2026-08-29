import { CUSTOM_ENTRIES_TAIL, CUSTOM_MESSAGE_HIDDEN, CUSTOM_MESSAGE_VISIBLE } from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Rendered-UI behaviour of the `customEntryFallback` kill switch (browser E2E,
 * test-plan #E11).
 *
 * Driver: the `[[faux:custom-entries]]` scenario emits custom content through
 * the REAL paths — `e2e_custom_message` → `pi.sendMessage` (role:"custom"
 * message_end) and `e2e_custom_entry` → `pi.appendEntry` (`entry_appended` →
 * bridge `custom_entry`) — and the generic `CustomEntryCard` rows render in
 * the live session. The gate is then toggled through the session's ⚙ View
 * popover, the surface a user actually reaches; rows must flip WITHOUT any
 * reload/replay (the gate is render-time only — rows stay in state).
 *
 * See change: render-inline-reasoning-and-custom-entries.
 */

test.setTimeout(150_000);

test.describe("customEntryFallback — the kill switch, end to end", () => {
  test("#E11 toggling the fallback hides and restores custom rows without reload", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:custom-entries]] go");

    // The display:true custom message + both appendEntry entries render as
    // generic cards (default fallback ON). The display:false message NEVER
    // renders — exclusion is independent of the gate.
    const visibleRow = page
      .locator('[data-testid="custom-entry-card"]', { hasText: CUSTOM_MESSAGE_VISIBLE })
      .first();
    await expect(visibleRow).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: "e2e:state" }).first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: "e2e:big" }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(CUSTOM_MESSAGE_HIDDEN, { exact: false }),
    ).toHaveCount(0);
    // The turn itself completed — the transcript is alive, not stuck.
    await expect(page.getByText(CUSTOM_ENTRIES_TAIL).first()).toBeVisible({ timeout: 30_000 });

    // Toggle the fallback OFF through the View popover (live view, no nav).
    // The checkbox is React-controlled over a WS round-trip; a click can land
    // on a re-rendered input, so retry until the state commits.
    await expect(async () => {
      await page.getByRole("button", { name: /view/i }).first().click();
      const popover = page.locator('[data-testid="chat-view-popover"]');
      await popover.waitFor({ state: "visible", timeout: 15_000 });
      const box = popover.getByRole("checkbox", { name: "Custom entries in chat" });
      await box.uncheck();
      await expect(box).not.toBeChecked();
    }).toPass({ timeout: 20_000 });

    // Every generic custom card disappears — WITHOUT reload or replay.
    await expect(page.locator('[data-testid="custom-entry-card"]')).toHaveCount(0);
    // The rest of the transcript is untouched (completion text still renders).
    await expect(page.getByText(CUSTOM_ENTRIES_TAIL).first()).toBeVisible();

    // Re-enable → the SAME rows return from state (no replay flicker).
    await expect(async () => {
      const box2 = page
        .locator('[data-testid="chat-view-popover"]')
        .getByRole("checkbox", { name: "Custom entries in chat" });
      await box2.check();
      await expect(box2).toBeChecked();
    }).toPass({ timeout: 20_000 });
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: CUSTOM_MESSAGE_VISIBLE }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: "e2e:big" }).first(),
    ).toBeVisible();
    // Close the popover so it cannot overlay later assertions.
    await page.keyboard.press("Escape");
  });
});
