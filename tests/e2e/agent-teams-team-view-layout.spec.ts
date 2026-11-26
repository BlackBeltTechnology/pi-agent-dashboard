import { expect, test } from "./fixtures.js";
import { type FixtureTask, routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { buttonBoxes } from "./helpers/computed-contrast.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — Team view layout (change: add-agent-teams-ui, tasks 14.1 + 14.7, test-plan S35, S96).
 *
 * OWNER DECISION (mockups/ui-plan.md "Decisions"): the Team view is TABS ON EVERY WIDTH,
 * so the S35 boundary at 1 023 / 1 024 px asserts the SAME tablist (Members · Tasks ·
 * Messages, one panel visible) on both sides — the test-plan wording "1024 → sections
 * visible together" is superseded by that decision (reported to the parent). What stays:
 * hit areas ≥ 44 px at 639 px and ≥ 24 px at 640 px; no horizontal page scroll with a
 * 400-char unbroken token at 320 px; task 50 reachable by keyboard focus through a
 * descendant scroller. Exemplar: mobile-viewport-bound.spec.ts.
 * STATUS: written, not yet run (needs the docker harness).
 */
const manyMembers = Array.from({ length: 10 }, (_, i) => ({ name: `member-${i}`, status: i % 2 ? "idle" : "busy", sessionId: `S-${i}` }));
const tasks12: FixtureTask[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), title: `Task ${i + 1}`, status: i % 3 === 0 ? "pending" : i % 3 === 1 ? "in_progress" : "completed" }));

async function open(page: import("@playwright/test").Page, over: Parameters<typeof teamState>[0]) {
  await routeTeams(page, routed(teamState(over)));
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
}

test.describe("Team view layout", () => {
  test("S35: one tablist at every width, one visible panel; targets ≥ 44 px at 639 and ≥ 24 px at 640", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, { members: manyMembers, tasks: tasks12 });
    for (const width of [1023, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("tablist", { name: "Team sections" })).toBeVisible();
      await expect(page.getByRole("tab")).toHaveText([/Members/, /Tasks/, /Messages/]);
      await expect(page.getByRole("tabpanel")).toHaveCount(1); // visible panels only
    }
    for (const [width, min] of [[639, 44], [640, 24]] as const) {
      await page.setViewportSize({ width, height: 900 });
      // the shell remounts the claim at the mobile breakpoint: wait for the ready view before measuring
      await expect(page.getByRole("tablist", { name: "Team sections" })).toBeVisible();
      await expect(page.getByTestId("team-panel-members")).toBeVisible();
      const boxes = await buttonBoxes(page.getByTestId("team-view"));
      expect(boxes.length).toBeGreaterThan(3);
      const small = boxes.filter((b) => b.h < min).map((b) => `${b.name} ${b.w}×${b.h}`);
      expect(small, `targets below ${min}px at ${width}px`).toEqual([]);
    }
  });

  test("S96: 400-char unbroken tokens wrap, no horizontal page scroll at 320 px; task 50 is keyboard reachable", async ({ page }) => {
    test.setTimeout(120_000);
    const token = "x".repeat(400);
    const fifty: FixtureTask[] = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), title: i === 0 ? token : `Task ${i + 1}`, status: "pending" }));
    // the session card lives in the sidebar, which is collapsed at 320 px: open at desktop width, then narrow
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, { tasks: fifty, members: [{ name: "alice", status: "busy", role: token }], mail: [{ id: 1, from: "alice", to: "lead", text: token }] });
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.getByRole("tablist", { name: "Team sections" })).toBeVisible();
    for (const tab of [/Members/, /Tasks/, /Messages/]) {
      await page.getByRole("tab", { name: tab }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal page scroll in ${tab}`).toBeLessThanOrEqual(0);
    }
    await page.getByRole("tab", { name: /Tasks/ }).click();
    await page.getByRole("button", { name: /^Pending/ }).first().focus().catch(() => {});
    const last = page.locator('[data-task="50"]');
    await last.focus();
    await expect(last).toBeInViewport();
    await expect(last).toBeFocused();
  });
});
