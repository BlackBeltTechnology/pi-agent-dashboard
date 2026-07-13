import { test, expect } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * E2E for change `add-change-summary-table` (task 8.3).
 *
 * Drives a real Edit tool event via the `tool-edit` faux fixture, then asserts
 * the two integrated surfaces:
 *   1. the session-header Changed Files summary chip appears and opens the
 *      split Changes section (rail), with the chat still mounted;
 *   2. a Changes-section row opens a `diff:` viewer tab.
 *
 * These surfaces are NOT gated by the `changeSummaryTable` display pref (only
 * the per-turn in-stream block is), so the assertions are preset-independent.
 * The `tool-edit` fixture edits `src/example.ts`; the session-diff derives the
 * changed file from the event stream, so the chip/rail populate even without a
 * real working-tree mutation.
 */
test.describe("change summary table", () => {
  test("changed-files chip opens the split Changes section and a diff tab", async ({ page }) => {
    await spawnFreshGitSession(page);
    await sendPrompt(page, "[[faux:tool-edit]] make an edit");

    // 1. The Changed Files summary chip appears once the edit event lands.
    const chip = page.getByTestId("changed-files-chip");
    await expect(chip).toBeVisible({ timeout: 15_000 });

    // 2. Activating it opens the split Changes section (rail) without a takeover.
    await chip.click();
    const rail = page.getByTestId("changes-rail-section");
    await expect(rail).toBeVisible({ timeout: 10_000 });
    // Chat stays mounted alongside the pane (no full-screen takeover).
    await expect(page.getByTestId("status-bar")).toBeVisible();

    // 3. A Changes-section row opens the file's diff tab.
    await rail.getByText("example.ts").first().click();
    // The diff tab carries a "diff" tag in the tab strip.
    await expect(page.getByRole("tab").filter({ hasText: "diff" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
