/**
 * L3: the subagent inspector renders under ephemeral `subagent_*` frame loss.
 * Spec `subagent-live-detail-reliability`, test-plan #X5 (task 8.67 of
 * decouple-plugins-from-core). Exemplars: subagent-live-timeline.spec.ts
 * (`[[faux:subagent-reasoning]]`, ~10 s), subagent-stop-finalize.spec.ts (WS
 * frame drop).
 *
 * The producer's ephemeral `subagent_*` event frames are dropped on the
 * browser's socket; the durable `tool_execution_update` partials (which carry
 * the full running snapshot) still arrive. Since the extraction the subagents
 * plugin's Agent finalizer hydrates `SessionState.subagents` from those
 * partials, so the inspector opened mid-run must show a timeline or the
 * "No detail available yet." empty state — never "Subagent not found in this
 * session.".
 *
 * STATUS: written, not yet run (needs the docker harness).
 */
import { expect, test } from "./fixtures.js";
import { dropServerFrames } from "./helpers/drop-ws-frames.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const RUNNING_CARD = '[data-testid="agent-activity-row"]';

test.describe("subagent inspector under frame loss", () => {
  test("opens mid-run with subagent_* frames dropped: timeline or empty state, never 'not found' (X5)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await dropServerFrames(page, (f) => f.type === "event" && (f.event?.eventType ?? "").startsWith("subagent_"));

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, "[[faux:subagent-reasoning]] go");

    // The Agent card is live (it renders from the durable tool_execution_update partials).
    await expect(page.locator(RUNNING_CARD).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /^Details$/ }).last().click();

    // Either the hydrated timeline or the explicit empty state…
    const timeline = page.getByTestId("minimal-live-entry").or(page.getByText(/sleep 3 && echo r-one/));
    const empty = page.getByText("No detail available yet.");
    await expect(timeline.or(empty).first()).toBeVisible({ timeout: 20_000 });

    // …and never the dead-end message, at any point while the run is observed.
    const notFound = page.getByText("Subagent not found in this session.");
    await expect(notFound).toHaveCount(0);
    await page.waitForTimeout(3_000);
    await expect(notFound).toHaveCount(0);
  });
});
