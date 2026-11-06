import { expect, test } from "./fixtures.js";
import { agentCardsToggle, gridCards, openIdleGrid } from "./helpers/flow-card-grid.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Graph-first flow panel: every agent card sits in an "Agent cards" section,
 * collapsed by default, its open state persisted per session; a graph node
 * click opens the section and scrolls the card into view.
 * See change: update-flows-plugin (D7; test-plan F1–F3).
 *
 * Fixture: `openIdleGrid` (6-step attached flow, pending cards — no engine run).
 */

test.describe("flow Agent cards section (L3)", () => {
  test("F1: collapsed by default, open state persists per session across reload", async ({ page }) => {
    const { panel, sid } = await openIdleGrid(page, { openCards: false });
    const toggle = agentCardsToggle(panel);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(gridCards(panel)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(gridCards(panel)).toHaveCount(6);

    await page.reload();
    await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`).click();
    const again = page.getByTestId("flow-dashboard");
    await expect(again).toHaveAttribute("data-flow-mode", "idle", { timeout: 30_000 });
    await expect(agentCardsToggle(again)).toHaveAttribute("aria-expanded", "true");
    await expect(gridCards(again)).toHaveCount(6);

    // A second session's section is still collapsed (per-session key).
    const other = await spawnFreshGitSession(page);
    const otherSid = (await other.getAttribute("data-session-id")) ?? "";
    expect(otherSid).not.toBe(sid);
    const stored = await page.evaluate((s) => localStorage.getItem(`dashboard:flow-cards-collapsed:${s}`), otherSid);
    expect(stored === null || stored === "true").toBe(true);
  });

  test("F2: clicking a graph node opens the section and scrolls its card into view; re-click clears", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    const { panel } = await openIdleGrid(page, { openCards: false });
    const toggle = agentCardsToggle(panel);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await panel.locator('[data-node="bare"]').click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const card = panel.locator('[data-step="bare"]');
    await expect(card).toHaveAttribute("data-selected", "true");
    // Visible inside the viewport after the scroll.
    await expect(card).toBeInViewport();
    await expect(panel.locator('[data-node="bare"]')).toHaveClass(/flow-node-selected/);

    await panel.locator('[data-node="bare"]').click();
    await expect(panel.locator('[data-node="bare"]')).not.toHaveClass(/flow-node-selected/);
    await expect(card).not.toHaveAttribute("data-selected", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("F3: disclosure hit target ≥ 44 px at 375 px, ≥ 32 px at 1280 px", async ({ page }) => {
    const { panel } = await openIdleGrid(page, { openCards: false });
    const toggle = agentCardsToggle(panel);
    await page.setViewportSize({ width: 1280, height: 800 });
    const wide = await toggle.boundingBox();
    expect(wide?.height ?? 0).toBeGreaterThanOrEqual(32);
    await page.setViewportSize({ width: 375, height: 800 });
    // Below md the slot renders the mobile collapsed bar first; tap it to expand.
    const bar = page.getByText("tap to expand");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await bar.click();
    const narrowToggle = agentCardsToggle(page.getByTestId("flow-dashboard"));
    await expect(narrowToggle).toBeVisible({ timeout: 15_000 });
    const narrow = await narrowToggle.boundingBox();
    expect(narrow?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
