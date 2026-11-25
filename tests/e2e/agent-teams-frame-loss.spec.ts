import { expect, test } from "./fixtures.js";
import { routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { dropServerFrames } from "./helpers/drop-ws-frames.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — frame loss (change: add-agent-teams-ui, task 14.13, test-plan S104).
 * Every `agent-teams:changed` frame is dropped: the open view still converges to the
 * server truth within 60 s (the visible safety timer's conditional GET) with no manual
 * reload. Playwright's fake clock fast-forwards the 60 s.
 * Exemplar: subagent-inspector-frame-loss.spec.ts. STATUS: written, not yet run (needs the docker harness).
 */
test("S104: with every frame dropped the view converges within 60 s via the safety timer", async ({ page }) => {
  test.setTimeout(120_000);
  await dropServerFrames(page, (f) => f.type === "plugin_event" && f.event?.eventType === "agent-teams:changed");
  const state = teamState();
  const r = routed(state);
  await routeTeams(page, r);
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  await page.clock.install();
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("team-member-status").first()).toHaveAttribute("data-status", "busy");

  // The server changes; no frame reaches the browser.
  state.rev = 2;
  state.members = [{ name: "alice", status: "idle" }, { name: "bob", status: "idle" }];
  const before = r.gets.length;
  await page.clock.fastForward(61_000);
  await expect.poll(() => r.gets.length, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.getByTestId("team-member-status").first()).toHaveAttribute("data-status", "idle", { timeout: 10_000 });
});
