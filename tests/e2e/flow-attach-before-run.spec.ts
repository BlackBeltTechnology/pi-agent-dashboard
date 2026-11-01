import { expect, test } from "./fixtures.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";
import { chipOpen, chipRun, expandSummary, pickFlow, waitForFlowsChip } from "./helpers/flows-chip.js";

// Change: attach-flow-before-run — L3 against the REAL pi-flows engine + faux
// agents (exemplar: flow-roundtrip.spec.ts). The harness bakes the synthetic
// 2-agent flow (`e2e:synthetic`, steps alpha → beta) under
// /fixtures/sample-git/.pi/flows/flows/e2e/synthetic/flow.yaml.
//
// F15: FLOWS chip Open flow… → pick → the flow slot shows the NOT-STARTED panel
//      (graph + pending cards) → idle Run → the same single panel goes live,
//      completes, then shows the (collapsed) summary.
// F16: Open flow… is disabled while a flow runs and re-enabled after it ends.
// Flow actions moved from the session actions menu to the dock chip. See change:
// flows-dock-chip-and-panel-actions.

const pickSynthetic = (page: import("@playwright/test").Page) => pickFlow(page, "synthetic");

test.describe("attach flow before run (L3: real pi-flows engine + faux agents)", () => {
  test("F15: open → not-started panel → Run → same panel live → summary", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Open flow… on the FLOWS chip (shown once the flows plugin published the catalog).
    await waitForFlowsChip(page);
    await expect(chipOpen(page)).toBeEnabled();
    await chipOpen(page).click();
    await pickSynthetic(page);

    // Not-started panel: header reads "not started", full graph, pending cards.
    const panel = page.getByTestId("flow-dashboard");
    await expect(panel).toHaveCount(1, { timeout: 30_000 });
    await expect(panel).toHaveAttribute("data-flow-mode", "idle");
    await expect(panel.getByText("not started")).toBeVisible();
    await expect(panel.locator("[data-node]")).toHaveCount(2);
    await expect(panel.locator("[data-step]")).toHaveCount(2);
    await expect(panel.getByText("waiting: alpha")).toBeVisible();
    await expect(panel.getByTestId("flow-idle-run")).toBeVisible();

    // The faux flow can finish in well under a second, so the live phase is
    // recorded in-page: the SAME idle element must flip to live (no remount),
    // "not started" must be gone while live, and at most one panel may exist.
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const idleEl = document.querySelector('[data-testid="flow-dashboard"]');
      w.__attach = { sameWentLive: false, liveShowedNotStarted: false, maxPanels: 1 };
      const rec = w.__attach as { sameWentLive: boolean; liveShowedNotStarted: boolean; maxPanels: number };
      const check = () => {
        const panels = document.querySelectorAll('[data-testid="flow-dashboard"]');
        rec.maxPanels = Math.max(rec.maxPanels, panels.length);
        if (idleEl?.isConnected && idleEl.getAttribute("data-flow-mode") === "live") {
          rec.sameWentLive = true;
          if (idleEl.textContent?.includes("not started")) rec.liveShowedNotStarted = true;
        }
      };
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });

    // Run from the idle header → launch dialog → submit.
    await panel.getByTestId("flow-idle-run").click();
    await byTestId(page, "flowLaunchRun").click();

    // Both steps finish → the slot forwards to the completed-flow summary
    // (collapsed by default; expand to see the body).
    await expandSummary(page);
    await expect(page.getByTestId("flow-summary-scrollbox")).toBeVisible();
    await expect(page.getByTestId("flow-dashboard")).toHaveCount(0);

    const rec = await page.evaluate(() => (window as unknown as { __attach: Record<string, unknown> }).__attach);
    // The same (single) panel went live; "not started" was gone while live.
    expect(rec.sameWentLive).toBe(true);
    expect(rec.liveShowedNotStarted).toBe(false);
    expect(rec.maxPanels).toBe(1);
  });

  test("F16: Open flow… disabled while a flow runs", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await waitForFlowsChip(page);
    await expect(chipOpen(page)).toBeEnabled();

    // The faux flow can finish in well under a second: record IN-PAGE whether the
    // chip's Open flow… was disabled while the live panel existed.
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__openWasDisabled = false;
      new MutationObserver(() => {
        if (!document.querySelector('[data-testid="flow-dashboard"][data-flow-mode="live"]')) return;
        const open = document.querySelector('[data-testid="flows-chip-open"]') as HTMLButtonElement | null;
        if (open?.disabled) w.__openWasDisabled = true;
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });

    await chipRun(page).click();
    await pickSynthetic(page);
    await byTestId(page, "flowLaunchRun").click();

    // Completion → summary; the action re-enables.
    await expect(page.getByTestId("flow-summary-panel-toggle")).toBeVisible({ timeout: 120_000 });
    await expect(chipOpen(page)).toBeEnabled({ timeout: 30_000 });
    const wasDisabled = await page.evaluate(() => (window as unknown as { __openWasDisabled: boolean }).__openWasDisabled);
    expect(wasDisabled).toBe(true);
  });
});
