import { test, expect } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * E2E for change `add-session-tags` (task 7.2 — the manual browser check,
 * automated here against the Docker harness).
 *
 * Drives the full user-facing round-trip through the REAL server + `.meta.json`
 * persistence + WS broadcast (no faux fixture needed — tags are dashboard-owned
 * state, independent of any model call):
 *   1. add a user tag via the detail-header editor (autocomplete popover);
 *   2. the colorized removable chip appears in the header;
 *   3. the tag survives a full page reload (server persisted + rebroadcast);
 *   4. the sidebar "Your tags" filter chip appears and selects (aria-pressed),
 *      keeping the tagged session visible; clearing resets it;
 *   5. removing the tag via the chip ✕ drops it.
 *
 * Selection uses the components' semantic aria-labels ("Add tag", "Tag name",
 * "Remove tag <t>", "Filter by tag <t>") — stable, accessibility-required
 * handles, not CSS/DOM structure. The header editable strip is the ONLY surface
 * with a "Remove tag" control (the card strip is read-only), so that label
 * uniquely identifies the header chip.
 */
test.describe("session tags", () => {
  test("add → persist across reload → filter → remove", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sid = await card.getAttribute("data-session-id");
    expect(sid).toBeTruthy();

    // Select the session so the desktop detail header (with the editor) mounts.
    await card.click();
    const addTag = page.getByRole("button", { name: "Add tag" });
    await expect(addTag).toBeVisible({ timeout: 30_000 });

    // Unique, already-normalized tag (lowercase, hyphen) so it never collides
    // with tags left by sibling specs sharing the container.
    const tag = `e2e-${Date.now().toString(36)}`;

    // 1. Add via the header editor popover.
    await addTag.click();
    const input = page.getByRole("textbox", { name: "Tag name" });
    await input.fill(tag);
    await input.press("Enter");

    // 2. The colorized removable chip appears in the header (editable strip →
    // unique "Remove tag" control).
    const removeBtn = page.getByRole("button", { name: `Remove tag ${tag}` });
    await expect(removeBtn).toBeVisible();

    // 3. Persist across a full reload: the server persisted the tag and
    // rebroadcasts it on reconnect, so the header re-renders it.
    await page.reload();
    await expect(page.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible({
      timeout: 30_000,
    });

    // 4. Sidebar "Your tags" filter chip appears, selects (aria-pressed), and
    // keeps the tagged session visible.
    const filterChip = page.getByRole("button", { name: `Filter by tag ${tag}` });
    await expect(filterChip).toBeVisible();
    await filterChip.click();
    await expect(filterChip).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`),
    ).toBeVisible();

    // Clearing the tag filter resets the axis.
    await page.getByTestId("clear-tag-filters").click();
    await expect(page.getByTestId("clear-tag-filters")).toHaveCount(0);

    // 5. Remove the tag via the chip ✕.
    await page.getByRole("button", { name: `Remove tag ${tag}` }).click();
    await expect(page.getByRole("button", { name: `Remove tag ${tag}` })).toHaveCount(0);
  });
});
