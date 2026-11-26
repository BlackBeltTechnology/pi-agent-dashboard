import { expect, type Page, test } from "./fixtures.js";
import { listTeamIds, shutdownTeamsCreatedSince } from "./helpers/agent-teams.js";
import { FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — the `/agent-team` command in the dashboard (change:
 * add-agent-teams-templates-hooks, task 15.9; test-plan #F9). Exemplar:
 * extension-slash-inprocess.spec.ts (an extension command dispatched in-process; the
 * terminal pill; no model turn).
 *
 * `/agent-team` is registered by the plugin's bridge (`pi.registerCommand`), so it reaches
 * the dashboard through the session's `commands_list` and shows in the composer's command
 * dropdown. `templates` and `start <template> "<goal>"` run in-process; their outcome is a
 * UI notify (a chat notice), never a failed-command pill. A start turns the session into a
 * lead: the lead badge appears and the playbook card renders in the chat.
 * The template is discovered from the harness's real listing: the fixture project template
 * `docker/fixtures/sample-git/.pi/teams/e2e-plain.md` (valid, no hooks, trusted). STATUS: run green against the docker harness.
 */
test.setTimeout(180_000);

const COMMAND = "/agent-team";

interface ListedTemplate {
  name: string;
  valid: boolean;
  trusted: boolean;
  hasHooks?: boolean;
}

async function listedTemplates(page: Page): Promise<ListedTemplate[] | undefined> {
  const res = await page.request.get(`/api/plugins/agent-teams/templates?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
  if (res.status() === 404) return undefined;
  return ((await res.json()) as { templates?: ListedTemplate[] }).templates ?? [];
}

/** Terminal labels of the command-feedback pills rendered for `command` (same DOM walk as extension-slash-inprocess.spec.ts). */
async function pillLabels(page: Page, command: string): Promise<string[]> {
  return page.evaluate((cmd: string) => {
    const out: string[] = [];
    for (const code of Array.from(document.querySelectorAll("code"))) {
      if (code.textContent?.trim() !== cmd) continue;
      out.push(code.nextElementSibling?.textContent?.trim() ?? "");
    }
    return out;
  }, command);
}

test.describe("/agent-team command", () => {
  // #F9 starts a REAL team; close it so a re-run on the same harness stays under the team cap.
  let teamsBefore: string[] = [];
  test.beforeEach(async ({ page }) => {
    teamsBefore = await listTeamIds(page);
  });
  test.afterEach(async ({ page }) => {
    await shutdownTeamsCreatedSince(page, teamsBefore);
  });

  test("#F9 the command is listed; `templates` and `start` surface their outcome as notices; the start makes a lead with a playbook card", async ({ page }) => {
    const templates = await listedTemplates(page);
    test.skip(templates === undefined, "agent-teams plugin routes are not served by this harness");
    const startable = templates?.find((t) => t.valid && t.trusted && !t.hasHooks);
    test.skip(!startable, "the harness has no startable template without hooks");

    const card = await spawnFreshGitSession(page);
    await card.click();

    // The command is in the session's command list: typing its prefix offers it in the dropdown.
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await composer.fill(COMMAND);
    const dropdown = page.getByTestId("command-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 20_000 });
    await expect(dropdown.getByText(COMMAND, { exact: false }).first()).toBeVisible();
    await composer.fill("");

    // `templates`: the notice names the listed template; the pill is completed, not failed.
    await sendPrompt(page, `${COMMAND} templates`);
    await expect(page.getByText(startable?.name ?? "", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await pillLabels(page, `${COMMAND} templates`)).join("|"), { timeout: 15_000, intervals: [200, 400, 800] }).toBe("completed");

    // An unknown template is a notice with the error code, not a failed command and not a team.
    await sendPrompt(page, `${COMMAND} start e2e-no-such-template "g"`);
    await expect(page.getByText(/template_not_found|not found/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("team-badge")).toHaveCount(0);

    // `start`: the session becomes the lead — badge + playbook card with the template and the goal.
    await sendPrompt(page, `${COMMAND} start ${startable?.name} "e2e command goal"`);
    await expect(card.getByTestId("team-badge")).toBeVisible({ timeout: 90_000 });
    const playbook = page.getByTestId("team-playbook-card").first();
    await expect(playbook).toBeVisible({ timeout: 60_000 });
    await expect(playbook.getByTestId("team-playbook-template")).toContainText(startable?.name ?? "");
    await expect(playbook.getByTestId("team-playbook-goal")).toContainText("e2e command goal");
  });
  // #F9 argument-completion half: the dashboard composer has no surface for pi's
  // getArgumentCompletions, so it cannot be asserted in the browser. The completer is
  // covered by the plugin bridge suite (bridge/__tests__/command.test.ts).
});
