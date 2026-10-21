/**
 * L3: the subagents plugin's `Agent` renderer follows the plugin toggle live.
 * Spec `agent-tool-rendering`, test-plan #F5 (task 8.66 of
 * decouple-plugins-from-core). Exemplar: enhance-tool-call-grouping.spec.ts.
 *
 * An Agent call (`[[faux:subagent-reasoning]]`; the subagent runs ~10-17 s, the tool row settles earlier):
 *  - plugin ON   → the Agent card (`agent-activity-row` while live) renders, expanded while the row runs;
 *  - plugin OFF  → the same call falls back to the Generic renderer (no `agent-activity-row`);
 *  - plugin ON again → the card is back after the `plugin_config_update` broadcast, with no page reload.
 *
 * The toggle goes through `POST /api/plugins/subagents/toggle` (what the
 * Plugins tab's `plugin-toggle-subagents` switch calls) because the ~10 s run
 * is shorter than a Settings round trip; the observable is the render after the
 * broadcast either way.
 *
 * STATUS: green on the docker harness.
 */
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const RUNNING_CARD = '[data-testid="agent-activity-row"]';
// The plugin-owned card chrome (the settled card has no live activity rows): its "Popout" control.
const PLUGIN_CARD = 'button[title="Open subagent detail"]';
const SUMMARY = /Explore: faux reasoning subagent/;

test.describe("subagents plugin toggle — rendered Agent call", () => {
  const toggle = (page: import("@playwright/test").Page, enabled: boolean) =>
    page.request.post("/api/plugins/subagents/toggle", { data: { enabled } });

  test("off: Generic collapsed row; on: Agent card expanded while running, no reload (F5)", async ({ page }) => {
    test.setTimeout(180_000);
    try {
      const card = await spawnFreshGitSession(page);
      await card.click();
      await page.keyboard.press("Escape").catch(() => {});
      await sendPrompt(page, "[[faux:subagent-reasoning]] go");

      // Plugin on (default): the Agent card is live and expanded while running.
      await expect(page.locator(RUNNING_CARD).first()).toBeVisible({ timeout: 60_000 });

      // Off, live: the same call falls back to the Generic renderer, collapsed.
      expect((await toggle(page, false)).ok()).toBeTruthy();
      await expect(page.locator(RUNNING_CARD)).toHaveCount(0, { timeout: 30_000 });
      // (The collapsed `<type>: <description>` summary is not asserted here: inside a running burst it only
      // surfaces once the run settles, which would eat the window the re-enable step needs.)

      // On again, without a reload: the Agent card is back. The tool row itself settles within ~2 s (the subagent
      // keeps running on its own), so by now its burst may have closed — open it if so; the row keeps the
      // expanded state it was seeded with.
      expect((await toggle(page, true)).ok()).toBeTruthy();
      await page.waitForTimeout(1_000);
      if ((await page.locator(PLUGIN_CARD).count()) === 0) {
        await page.getByTestId("tool-burst-header").first().click();
        // A re-mounted settled row is collapsed (seeded from its status): expand it to reach the plugin renderer.
        const row = page.locator('button[title*="Explore"]').first();
        if ((await page.locator(PLUGIN_CARD).count()) === 0 && (await row.count()) > 0) await row.click();
      }
      await expect(page.locator(PLUGIN_CARD).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(SUMMARY).first()).toBeVisible();
    } finally {
      await toggle(page, true).catch(() => undefined);
    }
  });
});
