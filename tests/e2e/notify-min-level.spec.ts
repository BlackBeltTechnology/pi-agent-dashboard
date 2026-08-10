import type { Page } from "@playwright/test";
import { NOTIFY_LEVEL_MESSAGES } from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Rendered-UI behaviour of the `notifyMinLevel` gate (browser E2E).
 *
 * Driver: `[[faux:notify-levels]]` emits four notifies — one per level —
 * through the `e2e_notify` fixture tool, i.e. the REAL path: `ctx.ui.notify` →
 * bridge notify proxy → `{type:"notify"}` → server notify log → client notify
 * reducer → NotifyRenderer row. The floor is then set from the per-session
 * View popover, which is the surface a user actually reaches.
 *
 * Covers test-plan #F15, #F16.
 * See change: gate-notify-rows-by-level.
 */

const LEVELS = ["info", "success", "warning", "error"] as const;

function notifyRow(page: Page, level: (typeof LEVELS)[number]) {
  return page.getByText(NOTIFY_LEVEL_MESSAGES[level], { exact: false });
}

/** Set the per-session notify floor through the ⚙ View popover. */
async function setNotifyFloor(page: Page, value: string): Promise<void> {
  await page.getByRole("button", { name: /view/i }).first().click();
  const select = page
    .locator('[data-testid="chat-view-popover"] [data-testid="notify-min-level"]')
    .first();
  await select.waitFor({ state: "visible", timeout: 15_000 });
  await select.selectOption(value);
  // Close the popover so it cannot overlay the transcript assertions.
  await page.keyboard.press("Escape");
}

test.describe("notifyMinLevel — the ladder, end to end", () => {
  test("#F15 a 'warnings' floor hides info+success and keeps warning+error", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-levels]] go");

    // All four render at the default floor ("all").
    for (const level of LEVELS) {
      await expect(notifyRow(page, level).first()).toBeVisible({ timeout: 60_000 });
    }

    await setNotifyFloor(page, "warnings");

    // Sub-floor rows disappear…
    await expect(notifyRow(page, "info")).toHaveCount(0);
    await expect(notifyRow(page, "success")).toHaveCount(0);
    // …and at/above-floor rows stay.
    await expect(notifyRow(page, "warning").first()).toBeVisible();
    await expect(notifyRow(page, "error").first()).toBeVisible();

    // The transcript tail is intact — the run's final assistant text still
    // renders, so the hidden rows did not clip the end of the list.
    await expect(page.getByText("all notify levels sent").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("#F15 'errors' never hides an error, and lowering the floor restores the rest", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-levels]] go");
    await expect(notifyRow(page, "error").first()).toBeVisible({ timeout: 60_000 });

    await setNotifyFloor(page, "errors");
    await expect(notifyRow(page, "info")).toHaveCount(0);
    await expect(notifyRow(page, "success")).toHaveCount(0);
    await expect(notifyRow(page, "warning")).toHaveCount(0);
    // The floor of the axis: an error is never suppressible.
    await expect(notifyRow(page, "error").first()).toBeVisible();

    // Reversible with no reload — the rows were never dropped from state.
    await setNotifyFloor(page, "all");
    for (const level of LEVELS) {
      await expect(notifyRow(page, level).first()).toBeVisible({ timeout: 30_000 });
    }
  });

  test("#F16 a blocking ask still renders and is answerable at the strictest floor", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Emit a notify first so the popover has a transcript to gate, then clamp.
    await sendPrompt(page, "[[faux:notify-levels]] go");
    await expect(notifyRow(page, "error").first()).toBeVisible({ timeout: 60_000 });
    await setNotifyFloor(page, "errors");
    await expect(notifyRow(page, "info")).toHaveCount(0);

    // The one that matters: a genuine ask must survive the strictest setting.
    await sendPrompt(page, "[[faux:ask-select]] go");
    const choice = page.getByRole("button", { name: /alpha/i }).first();
    await expect(choice).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });

    // …and remain answerable, clearing the pending state.
    await choice.click();
    await expect(card.getByText("Needs you")).toHaveCount(0, { timeout: 30_000 });
  });
});
