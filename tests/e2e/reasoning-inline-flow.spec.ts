import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Rendered-UI behaviour of the `reasoningInlineFlow` pref (browser E2E,
 * test-plan #E12).
 *
 * Driver: the `[[faux:thinking-long]]` scenario streams a multi-hundred-line
 * reasoning block through pi's LIVE event path, so the committed
 * `role:"thinking"` row mounts EXPANDED — a body genuinely taller than the
 * 400px cap, which is what makes the cap's presence/absence observable.
 *
 * The pref is toggled ON through the session's ⚙ View popover; the collapse
 * toggle must keep working in both modes (the pref governs HEIGHT ONLY).
 *
 * See change: render-inline-reasoning-and-custom-entries.
 */

const LONG_THINKING_DONE = "long thinking done";

async function patchReasoning(page: import("@playwright/test").Page): Promise<void> {
  // The committed block only renders when `reasoning` is on; auto-collapse 0
  // keeps it open so the class assertions are not racing a timer.
  const res = await page.request.patch("/api/preferences/display", {
    data: { reasoning: true, reasoningAutoCollapseMs: 0 },
  });
  expect(res.ok()).toBeTruthy();
}

async function setInlineFlow(page: import("@playwright/test").Page, on: boolean): Promise<void> {
  // React-controlled checkbox over a WS round-trip: retry until it commits.
  await expect(async () => {
    await page.getByRole("button", { name: /view/i }).first().click();
    const popover = page.locator('[data-testid="chat-view-popover"]');
    await popover.waitFor({ state: "visible", timeout: 15_000 });
    const box = popover.getByRole("checkbox", { name: "Inline reasoning flow" });
    if (on) await box.check();
    else await box.uncheck();
    await expect(box).toBeChecked({ checked: on });
    await page.keyboard.press("Escape");
  }).toPass({ timeout: 20_000 });
}

test.setTimeout(150_000);

test.describe("reasoningInlineFlow — uncapped height, end to end", () => {
  test("#E12 toggling inline flow removes the height cap; collapse still works", async ({ page }) => {
    await patchReasoning(page);

    const card = await spawnFreshGitSession(page);
    await card.click();
    // The send click can race the attaching session (button disabled mid-attach
    // swallows the first click) — retry until the user bubble commits.
    await expect(async () => {
      await sendPrompt(page, "[[faux:thinking-long]] go");
      await expect(page.getByText("[[faux:thinking-long]] go").first()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });

    // Live block mounts expanded; the long body is present under the DEFAULT
    // (capped) mode: max height + inner vertical scrollbar classes.
    await expect(page.getByText(LONG_THINKING_DONE).first()).toBeVisible({ timeout: 90_000 });
    const body = page.getByTestId("reasoning-body");
    await expect(body).toBeVisible();
    await expect(body).toHaveClass(/max-h-\[400px\]/);
    await expect(body).toHaveClass(/overflow-y-auto/);

    // Toggle inline flow ON via the settings UI in the live view.
    await setInlineFlow(page, true);
    await expect(page.getByTestId("reasoning-body")).toBeVisible();
    const uncapped = page.getByTestId("reasoning-body");
    // No vertical height cap, no inner vertical scrollbar…
    await expect(uncapped).not.toHaveClass(/max-h-\[400px\]/);
    await expect(uncapped).not.toHaveClass(/overflow-y-auto/);
    // …but horizontal overflow for long lines is kept.
    await expect(uncapped).toHaveClass(/overflow-x-auto/);

    // HEIGHT ONLY: the collapse toggle still works in inline-flow mode.
    await page.getByTestId("reasoning-block").last().locator("button").first().click();
    await expect(page.getByTestId("reasoning-body")).toHaveCount(0);
    await expect(page.getByTestId("reasoning-block").last()).toBeVisible();

    // Toggling back restores the capped mode.
    await setInlineFlow(page, false);
    await page.getByTestId("reasoning-block").last().locator("button").first().click();
    await expect(page.getByTestId("reasoning-body")).toBeVisible();
    await expect(page.getByTestId("reasoning-body")).toHaveClass(/max-h-\[400px\]/);

    // Keep the session state clean for other specs on this browser context.
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
  });
});
