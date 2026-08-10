import { test, expect } from "./fixtures.js";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — temporal tool-call BURST grouping.
//
// Sends `[[faux:burst-heterogeneous]]`; the faux fixture streams three DISTINCT
// bash calls (echo/echo/sleep+echo) then a final text. `groupToolBursts` wraps
// the run into one burst group:
//   • while the slow 3rd call runs → auto-expanded header "Working · N done"
//     + a live-command chip surfacing the running `$ sleep …`;
//   • once "burst complete" lands → auto-collapsed to "3 tool calls".
// Clicking the collapsed header re-expands the fixed-max-height scrollbox body.
//
// Scenario: qa/fixtures/faux-scenarios.ts → "burst-heterogeneous".
// See change: group-tool-call-bursts.
test.describe("faux round-trip — tool burst grouping", () => {
  test("burst forms, shows running header, then auto-collapses and re-expands", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:burst-heterogeneous]] go");

    const burst = page.getByTestId("tool-burst-group");
    await expect(burst).toBeVisible({ timeout: 30_000 });

    // While the slow 3rd call runs the burst is auto-expanded and the header
    // surfaces the live command (raced against the 2s sleep window).
    await expect(burst).toHaveAttribute("data-running", "true", { timeout: 10_000 });
    await expect(page.getByTestId("tool-burst-live-command")).toContainText("sleep");

    // Final text lands → burst auto-collapses to the honest done summary.
    await expect(page.getByText("burst complete").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tool-burst-header")).toContainText("3 tool calls");
    await expect(page.getByTestId("tool-burst-body")).toHaveCount(0);

    // Manual expand re-opens the scrollbox body with the member rows.
    await page.getByTestId("tool-burst-header").click();
    await expect(page.getByTestId("tool-burst-body")).toBeVisible();
    await expect(page.getByTestId("tool-burst-body")).toContainText("burst-one");
  });
});
