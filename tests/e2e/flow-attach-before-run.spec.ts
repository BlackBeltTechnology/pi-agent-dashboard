import { expect, test } from "./fixtures.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Change: attach-flow-before-run — L3 against the REAL pi-flows engine + faux
// agents (exemplar: flow-roundtrip.spec.ts). The harness bakes the synthetic
// 2-agent flow (`e2e:synthetic`, steps alpha → beta) under
// /fixtures/sample-git/.pi/flows/flows/e2e/synthetic/flow.yaml.
//
// F15: subcard Open flow… → pick → the flow slot shows the NOT-STARTED panel
//      (graph + pending cards) → idle Run → the same single panel goes live,
//      completes, then shows the summary.
// F16: Open flow… is disabled while a flow runs and re-enabled after it ends.

async function pickSynthetic(page: import("@playwright/test").Page) {
  const search = page.getByPlaceholder("Search flows...");
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("synthetic");
  await page.getByText("synthetic", { exact: false }).first().click();
}

test.describe("attach flow before run (L3: real pi-flows engine + faux agents)", () => {
  test("F15: open → not-started panel → Run → same panel live → summary", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const open = card.getByTestId("flows-open-button");
    await expect(open).toBeVisible({ timeout: 60_000 });
    await expect(open).toBeEnabled();
    await open.click();
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

    // Both steps finish → the slot forwards to the completed-flow summary.
    await expect(page.getByTestId("flow-summary-scrollbox")).toBeVisible({ timeout: 120_000 });
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

    const runFlow = card.getByRole("button", { name: /run flow/i });
    await expect(runFlow).toBeVisible({ timeout: 60_000 });
    const open = card.getByTestId("flows-open-button");
    await expect(open).toBeEnabled();

    // The faux flow can finish in well under a second: record in-page whether
    // the Open button was ever disabled after the run was submitted.
    await open.evaluate((btn) => {
      const w = window as unknown as Record<string, unknown>;
      w.__openWasDisabled = false;
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="flows-open-button"]') as HTMLButtonElement | null;
        if (el?.disabled) w.__openWasDisabled = true;
      }).observe(btn.ownerDocument.body, { subtree: true, childList: true, attributes: true });
    });

    await runFlow.click();
    await pickSynthetic(page);
    await byTestId(page, "flowLaunchRun").click();

    // Completion → summary; the button re-enables.
    await expect(page.getByTestId("flow-summary-scrollbox")).toBeVisible({ timeout: 120_000 });
    await expect(open).toBeEnabled({ timeout: 30_000 });
    const wasDisabled = await page.evaluate(() => (window as unknown as { __openWasDisabled: boolean }).__openWasDisabled);
    expect(wasDisabled).toBe(true);
  });
});
