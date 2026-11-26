import { expect, test } from "./fixtures.js";
import { sessionIdOf } from "./helpers/agent-teams.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — end-to-end render of a real team (change: add-agent-teams-ui, task 14.12, test-plan S103).
 * The ONE full-path spec: a faux-model scripted lead (`agent-teams-lead-spawn`: TeamCreate +
 * TeammateSpawn(alice); `agent-teams-lead-task`: one TaskCreate — qa/fixtures/faux-scenarios.ts,
 * shared with agent-teams-core.spec.ts) is watched through the Team view: the lead badge
 * appears live, the members table shows alice with status text, the board lists the task,
 * the log is reachable, and the user's Shut down team (real confirm dialog) ends in a closed,
 * read-only header. NO page.route fixtures here — the whole path is real.
 *
 * GAP (reported to the parent): the test-plan row also wants 2 teammates, 3 tasks with
 * dependencies and "teammates finish"; that needs a new faux scenario in
 * qa/fixtures/faux-scenarios.ts, which this change does not add. Skips when the plugin
 * routes are absent. STATUS: written, not yet run (needs the docker harness).
 */
test("S103: lead creates a team and a task; the Team view shows it live; Shut down ends read-only", async ({ page }) => {
  test.setTimeout(240_000);
  const probe = await page.request.get("/api/plugins/agent-teams/teams");
  test.skip(probe.status() === 404, "agent-teams plugin routes are not served by this harness");

  const card = await spawnFreshGitSession(page);
  const sid = await sessionIdOf(card);
  await card.click();
  await sendPrompt(page, "[[faux:agent-teams-lead-spawn]] go");

  // The lead badge appears live (session_updated over the real socket).
  const badge = card.getByTestId("team-badge");
  await expect(badge).toBeVisible({ timeout: 90_000 });
  await badge.click();
  await expect(page).toHaveURL(new RegExp(`/session/${sid}/team$`));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });

  // Members: alice shows up with visible status text (starting → working / idle), never blank.
  const alice = page.locator('[data-member="alice"]');
  await expect(alice).toBeVisible({ timeout: 60_000 });
  await expect(alice.getByTestId("team-member-status")).toHaveText(/.{3,}/);

  // A task created by the lead lands on the board (live: the frame or the safety timer, no reload).
  await page.getByTestId("team-back").click();
  await sendPrompt(page, "[[faux:agent-teams-lead-task]] go");
  await badge.click();
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await expect(page.getByTestId("team-task-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("team-task-card").first()).toContainText("e2e task");
  await page.getByRole("tab", { name: /Messages/ }).click();
  await expect(page.getByTestId("team-log")).toBeVisible();

  // The user shuts the team down: closing → closed, read-only (no controls).
  await page.getByTestId("team-shutdown").click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: /shut down team/i }).click();
  await expect(page.getByTestId("team-closed")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("team-shutdown")).toHaveCount(0);
  await expect(page.getByTestId("team-member-stop")).toHaveCount(0);
});
