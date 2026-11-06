import { expect, test } from "./fixtures.js";
import { chipRun, expandSummary, pickFlow, waitForFlowsChip } from "./helpers/flows-chip.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Real pi-flows engine running the baked `e2e:tools` flow: its single code
 * node runs `git --version` through the flows-plugin tool-registry facade
 * (`Symbol.for("pi-dashboard.flow-tools")`) and throws when the facade is
 * absent, so success proves dashboard code nodes reach the registry.
 * See change: add-flow-code-node-tools (test-plan F1; exemplars
 * flow-fanout-decision.spec.ts, flow-roundtrip.spec.ts).
 */
test.describe("flow code nodes reach the dashboard tool registry (L3: real engine)", () => {
  test("F1: code node runs git via the facade and the flow succeeds", async ({ page }) => {
    test.setTimeout(240_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    const sid = (await card.getAttribute("data-session-id")) ?? "";
    await page.evaluate((s) => {
      localStorage.setItem(`dashboard:flow-dashboard-collapsed:${s}`, "false");
      localStorage.setItem(`dashboard:flow-summary-collapsed:${s}`, "false");
      localStorage.setItem(`dashboard:flow-cards-collapsed:${s}`, "false");
    }, sid);

    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "tools");
    await byTestId(page, "flowLaunchRun").click();

    await expandSummary(page);
    const summary = page.getByTestId("flow-summary-scrollbox").locator("xpath=..");
    await expect(summary.locator('[data-node="probe"]')).toHaveAttribute("data-status", "complete");
    await expect(summary.locator('[data-step="probe"]')).toContainText(/git version/);
  });
});
