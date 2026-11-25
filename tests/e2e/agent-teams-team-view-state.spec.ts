import { expect, test } from "./fixtures.js";
import { changedFrame, routed, routeTeams, sessionIdOf, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { installFrameInjector, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — Team view UI state across a refresh (change: add-agent-teams-ui, task 13.54, test-plan S92).
 * An open task disclosure, the message filter and the focused "Open session" link
 * survive a refetch that replaces the snapshot; a task moving Pending → In progress
 * keeps its open disclosure; a filter on a vanished member resets with an inline note.
 * Exemplar: goal-plugin GoalsBoardClaim (L1) / gateway-board-mobile.spec.ts.
 * STATUS: written, not yet run (needs the docker harness).
 */
test("S92: disclosure, filter and focus survive a refresh; vanished member resets the filter", async ({ page }) => {
  test.setTimeout(120_000);
  const injector = await installFrameInjector(page);
  const state = teamState({
    leadSessionId: "pending",
    members: [
      { name: "alice", status: "busy", sessionId: "S-alice" },
      { name: "bob", status: "idle", sessionId: "S-bob" },
    ],
    mail: [
      { id: 1, from: "bob", to: "lead", text: "from bob" },
      { id: 2, from: "alice", to: "lead", text: "from alice" },
    ],
    tasks: [
      { id: "3", title: "Third", status: "pending", description: "details of three" },
      { id: "4", title: "Fourth", status: "pending" },
    ],
  });
  const r = routed(state);
  await routeTeams(page, r);
  const card = await spawnFreshGitSession(page);
  const sid = await sessionIdOf(card);
  state.leadSessionId = sid;
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page.locator('[data-task="3"] [data-testid="team-task-toggle"]').click();
  await page.getByRole("tab", { name: /Messages/ }).click();
  await page.getByLabel("Member").selectOption("bob");
  await page.getByRole("tab", { name: /Members/ }).click();
  const link = page.locator('[data-member="alice"] [data-testid="team-member-open-subagent"]');
  await link.focus();

  // Refetch with Task 3 moved to In progress.
  state.rev = 2;
  state.tasks = [
    { id: "3", title: "Third", status: "in_progress", owner: "alice", description: "details of three" },
    { id: "4", title: "Fourth", status: "pending" },
  ];
  injector.send(changedFrame(sid, state.id, 2));
  await expect.poll(() => r.gets.filter((g) => /\/teams\/t-e2e$/.test(g)).length, { timeout: 15_000 }).toBeGreaterThan(1);

  await expect(link).toBeFocused();
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await expect(page.locator('[data-testid="team-board-section-in_progress"] [data-task="3"] [data-testid="team-task-details"]')).toContainText("details of three");
  await page.getByRole("tab", { name: /Messages/ }).click();
  await expect(page.getByLabel("Member")).toHaveValue("bob");

  // bob leaves: the filter resets to "all" with an inline note.
  state.rev = 3;
  state.members = [{ name: "alice", status: "busy", sessionId: "S-alice" }];
  injector.send(changedFrame(sid, state.id, 3));
  await expect(page.getByTestId("team-log-vanished")).toContainText("bob left the team", { timeout: 15_000 });
  await expect(page.getByLabel("Member")).toHaveValue("all");
});
