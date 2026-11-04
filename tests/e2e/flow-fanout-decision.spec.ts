import { expect, test } from "./fixtures.js";
import { chipRun, expandSummary, pickFlow, waitForFlowsChip } from "./helpers/flows-chip.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Real pi-flows 0.10 engine (harness PI_FLOWS_VERSION 0.10.0) running the baked
 * `e2e:fanout` flow: `list` yields 3 items, the multi decision `triage` picks
 * `fan` only (faux `flow-multi-decision`), `fan` runs once per item with item 1
 * failing soft (faux `flow-item-branch`), and `doc` is skipped. Drives the
 * forwarded `flow_decision`, item-indexed lifecycle events and `skipped` results
 * through the flows plugin bridge declaration to the panel.
 * See change: update-flows-plugin (test-plan F4; exemplar flow-attach-before-run).
 */
test.describe("pi-flows 0.10 fan-out + decision (L3: real engine + faux agents)", () => {
  test("F4: group card x3 with 1 failed, doc skipped, triage shows its chosen route", async ({ page }) => {
    test.setTimeout(240_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    const sid = (await card.getAttribute("data-session-id")) ?? "";
    // Seed the panel + Agent cards section open, so the frozen summary renders
    // the grid without extra clicks.
    await page.evaluate((s) => {
      localStorage.setItem(`dashboard:flow-dashboard-collapsed:${s}`, "false");
      localStorage.setItem(`dashboard:flow-summary-collapsed:${s}`, "false");
      localStorage.setItem(`dashboard:flow-cards-collapsed:${s}`, "false");
    }, sid);

    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "fanout");
    await byTestId(page, "flowLaunchRun").click();

    // Converges to a terminal status → the summary panel.
    await expandSummary(page);
    const summary = page.getByTestId("flow-summary-scrollbox").locator("xpath=..");

    // Graph words (summary graph shares flowStateToGraphSteps).
    await expect(summary.locator('[data-node="fan"] text')).toContainText("x3 (1 failed)");
    await expect(summary.locator('[data-node="doc"] text')).toContainText("skipped");
    await expect(summary.locator('[data-node="doc"]')).toHaveAttribute("data-status", "skipped");
    await expect(summary.locator('[data-node="triage"] text')).toContainText("fan");
    // The `doc` card reads skipped too.
    await expect(summary.locator('[data-step="doc"]')).toBeVisible();
  });

  test("F4 (live): the running panel's Agent cards show the fan-out group with 3 items", async ({ page }) => {
    test.setTimeout(240_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    const sid = (await card.getAttribute("data-session-id")) ?? "";
    await page.evaluate((s) => {
      localStorage.setItem(`dashboard:flow-dashboard-collapsed:${s}`, "false");
      localStorage.setItem(`dashboard:flow-cards-collapsed:${s}`, "false");
    }, sid);
    // Record the group card's item count and failed pill while the panel is live
    // (the faux run can finish in well under a second).
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__fan = { maxItems: 0, sawFailed: false, sawSkipped: false, sawRoute: false };
      const rec = w.__fan as { maxItems: number; sawFailed: boolean; sawSkipped: boolean; sawRoute: boolean };
      new MutationObserver(() => {
        const group = document.querySelector('[data-testid="flow-group-card"]');
        if (group) {
          rec.maxItems = Math.max(rec.maxItems, group.querySelectorAll("[data-item]").length);
          if (/1 failed/.test(group.textContent ?? "")) rec.sawFailed = true;
        }
        if (document.querySelector('[data-testid="flow-skipped-card"]')) rec.sawSkipped = true;
        if (/fan x3/.test(document.querySelector('[data-testid="flow-decision-routes"]')?.textContent ?? "")) rec.sawRoute = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });

    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "fanout");
    await byTestId(page, "flowLaunchRun").click();
    await expect(page.getByTestId("flow-summary-panel-toggle")).toBeVisible({ timeout: 180_000 });

    const rec = await page.evaluate(() => (window as unknown as { __fan: Record<string, unknown> }).__fan);
    expect(rec.maxItems).toBe(3);
    expect(rec.sawFailed).toBe(true);
    expect(rec.sawSkipped).toBe(true);
    expect(rec.sawRoute).toBe(true);
  });
});
