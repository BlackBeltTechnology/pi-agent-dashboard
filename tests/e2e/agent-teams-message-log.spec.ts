import { expect, test } from "./fixtures.js";
import { changedFrame, type FixtureMail, routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { installFrameInjector, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — follow-newest message log (change: add-agent-teams-ui, task 14.9, test-plan S98).
 * 40 rows: at the end the view follows a new mail; scrolled up there is no jump and a
 * "New messages" button appears (click scrolls to the end); ≤ 8 px from the bottom
 * counts as the end. Exemplar: gateway-board-mobile.spec.ts.
 * STATUS: written, not yet run (needs the docker harness).
 */
const rows = (n: number): FixtureMail[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, from: "alice", to: "lead", text: `message ${i + 1}` }));

test("S98: follows only while at the end; otherwise 'New messages'", async ({ page }) => {
  test.setTimeout(120_000);
  const injector = await installFrameInjector(page);
  const state = teamState({ mail: rows(40), leadSessionId: "pending" });
  const r = routed(state);
  await routeTeams(page, r);
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  state.leadSessionId = sid;
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Messages/ }).click();
  const log = page.getByTestId("team-log-scroller");
  const gap = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  const push = async (rev: number) => {
    state.rev = rev;
    state.mail = rows(40 + (rev - 1));
    injector.send(changedFrame(sid, state.id, rev));
    await expect.poll(() => r.gets.filter((g) => /\/teams\/t-e2e$/.test(g)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(rev);
  };

  // At the end: the view follows.
  await log.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await push(2);
  await expect.poll(gap, { timeout: 5_000 }).toBeLessThanOrEqual(8);
  await expect(page.getByTestId("team-log-new")).toHaveCount(0);

  // Scrolled up: no jump, a "New messages" button.
  await log.evaluate((el) => (el.scrollTop = 0));
  await push(3);
  await expect(page.getByTestId("team-log-new")).toBeVisible();
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByTestId("team-log-new").click();
  await expect.poll(gap).toBeLessThanOrEqual(8);
  await expect(page.getByTestId("team-log-new")).toHaveCount(0);

  // Tolerance: exactly 8 px above the bottom still counts as the end.
  await log.evaluate((el) => (el.scrollTop = el.scrollHeight - el.clientHeight - 8));
  await push(4);
  await expect(page.getByTestId("team-log-new")).toHaveCount(0);
});
