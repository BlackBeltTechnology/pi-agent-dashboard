/**
 * L3: a subagent card finalizes from the subagent's own stop signal when the
 * Agent tool's `tool_execution_end` frame never reaches the browser.
 * Folded from test-plan.md F11. Exemplars: reconcile-heal.spec.ts (WS frame
 * drop), subagent-live-timeline.spec.ts (`[[faux:subagent-reasoning]]`, ~10 s).
 *
 * Without the change the card spins until the HTTP stale reconcile
 * (`STALE_TOOL_MS` ≈ 25 s) heals it. With it, `subagent_completed` (or the
 * parent `agent_settled`) finalizes the card within seconds.
 * See change: finalize-agent-card-on-subagent-stop.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const RUNNING_CARD = '[data-testid="agent-activity-row"]';

/** Drop only the Agent call's server→browser `tool_execution_end`; forward everything else. */
async function dropAgentEndFrames(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (typeof m === "string") {
        try {
          const parsed = JSON.parse(m) as { type?: string; event?: { eventType?: string; data?: { toolName?: string } } };
          if (
            parsed.type === "event" &&
            parsed.event?.eventType === "tool_execution_end" &&
            parsed.event.data?.toolName === "Agent"
          ) {
            return; // DROP
          }
        } catch {
          // forward
        }
      }
      ws.send(m);
    });
  });
}

test.describe("subagent stop finalizes its card", () => {
  test("a dropped Agent end does not leave the card spinning (F11)", async ({ page }) => {
    test.setTimeout(120_000);
    await dropAgentEndFrames(page);

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, "[[faux:subagent-reasoning]] go");

    // The subagent runs ~10 s: the card is live first.
    await expect(page.locator(RUNNING_CARD).first()).toBeVisible({ timeout: 60_000 });

    // The parent's follow-up proves the subagent finished (its end was dropped).
    await expect(page.getByText(/reasoning subagent complete/i).first()).toBeVisible({ timeout: 60_000 });
    const finishedAt = Date.now();

    // Finalized well before the 25 s stale reconcile could have healed it.
    await expect(page.locator(RUNNING_CARD)).toHaveCount(0, { timeout: 8_000 });
    expect(Date.now() - finishedAt).toBeLessThan(10_000);

    // The subagent's own result was known, so no "result not received" badge.
    await expect(page.getByTestId("tool-recovered-badge")).toHaveCount(0);
    await expect(page.getByTestId("tool-superseded-badge")).toHaveCount(0);
  });
});
