import {
  WEB_SEARCH_LINK,
  WEB_SEARCH_SUMMARY,
  WEB_SEARCH_TAIL,
} from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Rendered-UI behaviour of the web-access `custom-entry-renderer` claim against
 * a live session (browser E2E, test-plan #F17/#F18; change:
 * render-unclaimed-custom-entries).
 *
 * The `[[faux:web-search-entry]]` scenario drives the REAL `pi.appendEntry` path with
 * a `web-search-results` entry (2 queries, 8 results, one https link) BETWEEN two tool
 * calls of one burst. The `search` event group is visible by default, so no popover step.
 *
 * Promise: the row is a labelled one-line summary inside the tool burst (the claimed row
 * is transparent to burst formation), expanding it fetches the payload exactly once and
 * renders the link safely, and a cold reload rebuilds the same collapsed summary.
 */
test.setTimeout(180_000);

test.describe("web-search custom entries render through the web-access plugin", () => {
  test("#F17/#F18 collapsed summary in the burst, safe link on expand, replay parity", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    const entryRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/api\/sessions\/[^/]+\/entry\//.test(req.url())) entryRequests.push(req.url());
    });

    await sendPrompt(page, "[[faux:web-search-entry]] go");
    await expect(page.getByText(WEB_SEARCH_TAIL).first()).toBeVisible({ timeout: 60_000 });

    // The claimed row is TRANSPARENT to burst formation, so it lives INSIDE the burst
    // (which renders collapsed by default) instead of splitting it.
    const burst = page.locator('[data-testid="tool-burst-group"]', { hasText: "e2e_custom_entry" });
    await expect(burst).toHaveCount(1, { timeout: 15_000 });
    await burst.getByTestId("tool-burst-header").first().click();

    const row = burst.getByTestId("web-search-entry").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("web-search-summary")).toHaveText(WEB_SEARCH_SUMMARY);
    await expect(page.locator('[data-testid="custom-entry-card"]', { hasText: "web-search-results" })).toHaveCount(0);
    // Collapsed = zero payload requests.
    expect(entryRequests).toHaveLength(0);

    // Expand → the payload is fetched ONCE; the https URL is a safe link, others are text.
    await row.getByTestId("web-search-toggle").click();
    const link = row.locator("a", { hasText: WEB_SEARCH_LINK });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(row.locator("a")).toHaveCount(4); // 1 + 3 https results; the 4 javascript: URLs are text
    await expect(row.getByTestId("web-search-answer").first()).toHaveText("e2e synthesized answer");
    expect(entryRequests).toHaveLength(1);

    // #F18 — cold reload: the chat is rebuilt from the JSONL; same collapsed summary.
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await page
      .locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`)
      .click();
    await expect(page.getByText(WEB_SEARCH_TAIL).first()).toBeVisible({ timeout: 30_000 });
    const replayBurst = page.locator('[data-testid="tool-burst-group"]', { hasText: "e2e_custom_entry" });
    await replayBurst.getByTestId("tool-burst-header").first().click();
    const replayRow = replayBurst.getByTestId("web-search-entry").first();
    await expect(replayRow.getByTestId("web-search-summary")).toHaveText(WEB_SEARCH_SUMMARY, { timeout: 30_000 });
    await replayRow.getByTestId("web-search-toggle").click();
    await expect(replayRow.locator("a", { hasText: WEB_SEARCH_LINK })).toBeVisible({ timeout: 15_000 });
    await expect(replayRow.getByTestId("web-search-answer").first()).toHaveText("e2e synthesized answer");
  });
});
