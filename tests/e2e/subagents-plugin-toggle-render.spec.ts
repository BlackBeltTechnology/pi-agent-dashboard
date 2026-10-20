/**
 * L3: the subagents plugin's `Agent` renderer follows the plugin toggle live.
 * Spec `agent-tool-rendering`, test-plan #F5 (task 8.66 of
 * decouple-plugins-from-core). Exemplar: enhance-tool-call-grouping.spec.ts.
 *
 * A running Agent call (`[[faux:subagent-reasoning]]`, ~10 s):
 *  - plugin OFF  → the call renders through the Generic renderer, collapsed
 *    (no `agent-activity-row`, the collapsed `<type>: <description>` summary);
 *  - plugin ON   → the Agent card renders EXPANDED while running (the claim's
 *    `expandWhileRunning`), after the `plugin_config_update` broadcast and
 *    with no page reload.
 *
 * The toggle goes through `POST /api/plugins/subagents/toggle` (what the
 * Plugins tab's `plugin-toggle-subagents` switch calls) because the ~10 s run
 * is shorter than a Settings round trip; the observable is the render after the
 * broadcast either way.
 *
 * STATUS: written, not yet run (needs the docker harness).
 */
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const RUNNING_CARD = '[data-testid="agent-activity-row"]';
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
      await expect(page.getByText(SUMMARY).first()).toBeVisible();

      // On again, without a reload: the card is back and expanded while running.
      expect((await toggle(page, true)).ok()).toBeTruthy();
      await expect(page.locator(RUNNING_CARD).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await toggle(page, true).catch(() => undefined);
    }
  });
});
