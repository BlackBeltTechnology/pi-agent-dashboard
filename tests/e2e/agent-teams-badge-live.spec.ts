import { expect, test } from "./fixtures.js";
import { routed, routeTeams, sessionIdOf, teamRefFrame, teamState } from "./helpers/agent-teams.js";
import { installFrameInjector, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — live session badge (change: add-agent-teams-ui, task 13.52, test-plan S90).
 * A plain session has no badge; a `session_updated` top-level `agent-teams-lead` ref
 * makes it appear without a reload, `{teamId:null}` clears it; the badge is a
 * keyboard-focusable link named "Open team view, <role>" and Enter opens the view.
 * Exemplar: compact-session-card-header.spec.ts. STATUS: written, not yet run (needs the docker harness).
 */
test.describe("agent-teams session badge, live", () => {
  test("appears and disappears on session_updated; keyboard reachable; Enter opens the Team view", async ({ page }) => {
    test.setTimeout(120_000);
    const injector = await installFrameInjector(page);
    await routeTeams(page, routed(teamState()));
    const card = await spawnFreshGitSession(page);
    const sid = await sessionIdOf(card);
    const badge = card.getByTestId("team-badge");

    await expect(badge, "a plain session carries no badge").toHaveCount(0);

    injector.send(teamRefFrame(sid, "t-e2e"));
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveAccessibleName("Open team view, Lead");

    // Keyboard: the badge is a link in the tab order with a visible focus ring.
    // Reach it with real key presses: `:focus-visible` (the host `focus-ring`) never
    // matches a script-only `.focus()` after pointer input.
    await badge.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(badge).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(badge).toBeFocused();
    const outline = await badge.evaluate((el) => getComputedStyle(el).outlineStyle + getComputedStyle(el).boxShadow);
    expect(outline).not.toMatch(/^none(none)?$/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/session/${sid}/team$`));
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 15_000 });

    // The badge is session-list data: clearing the ref removes it live.
    injector.send(teamRefFrame(sid, null));
    await expect(badge).toHaveCount(0, { timeout: 15_000 });
  });
});
