import { test, expect } from "./fixtures.js";
import { dismissToasts, robustClick, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

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
 * The `tool-edit` fixture edits `README.md` — a file that EXISTS in the
 * sample-git fixture. It must: the editor-pane Changes rail now renders its
 * per-file rows inline in the DISK-backed file tree (change:
 * collapse-diff-file-tree), so an edit to a fabricated path would have no row
 * to open.
 */
test.describe("change summary table", () => {
  test("changed-files chip opens the split Changes section and a diff tab", async ({ page }) => {
    await spawnFreshGitSession(page);
    await sendPrompt(page, "[[faux:tool-edit]] make an edit");

    // 1. The Changed Files summary chip appears once the edit event lands.
    await expect(page.getByTestId("changed-files-chip")).toBeVisible({ timeout: 15_000 });

    // 2. Activating it opens the split Changes section (rail) without a takeover.
    // robustClick: a spawn toast sits over the session header and intercepts the
    // chip click, which otherwise never goes "stable".
    await robustClick(page, "changed-files-chip");
    const rail = page.getByTestId("changes-rail-section");
    await expect(rail).toBeVisible({ timeout: 10_000 });
    // Chat stays mounted alongside the pane (no full-screen takeover).
    await expect(page.getByTestId("status-bar")).toBeVisible();

    // 3. A changes row opens the file's diff tab. The per-file rows no longer
    // live in `changes-rail-section` (now a slim summary bar) — they render
    // inline in the editor file tree, keyed by `data-row=<rel>`
    // (change: collapse-diff-file-tree). `README.md` is at the tree root, so no
    // folder expansion is needed; its row carries the `diff` chip.
    await dismissToasts(page);
    await page.locator('[data-row="README.md"] [data-testid="open-diff-chip"]').click();
    // The diff tab carries a "diff" tag in the tab strip.
    await expect(page.getByRole("tab").filter({ hasText: "diff" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
