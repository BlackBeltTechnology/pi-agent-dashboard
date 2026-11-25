import { expect, test } from "./fixtures.js";
import { routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — lazy chunk failure (change: add-agent-teams-ui, task 14.3, test-plan S85).
 * `page.route` aborts the Team view chunk: the route shows the host overlay failure
 * panel — never blank — and the page raises no uncaught error spam. (Mail-card and
 * tool-card chunk aborts fall back to the host generic renderers; that half is covered
 * at L1 by lazy-cards.test.tsx against the real `CustomEntryRow`.)
 * Exemplar: runtime-plugin-loading.spec.ts. STATUS: written, not yet run (needs the docker harness).
 */
test("S85: an aborted Team view chunk shows the host failure panel, not a blank page", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await routeTeams(page, routed(teamState()));
  const sid = await sessionIdOf(await spawnFreshGitSession(page));

  await page.route(/\/assets\/(TeamView|MailEntryCard|TeamToolRenderers)-[\w-]+\.js/, (route) => route.abort());
  await page.goto(teamViewUrl(sid));

  // Never blank: the host's overlay failure panel (alert) takes the claim's place.
  const panel = page.getByRole("alert").first();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  expect((await panel.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  await expect(page.getByTestId("team-view")).toHaveCount(0);
  expect(errors.filter((m) => !/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(m))).toEqual([]);
});
