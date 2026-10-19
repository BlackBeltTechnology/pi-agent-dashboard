import { expect, test } from "./fixtures.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";
import { closeSessionMenu, flowMenuItem, openSessionMenu } from "./helpers/session-actions-menu.js";

// Change: attach-flow-before-run — L3 against the REAL pi-flows engine + faux
// agents (exemplar: flow-roundtrip.spec.ts). The harness bakes the synthetic
// 2-agent flow (`e2e:synthetic`, steps alpha → beta) under
// /fixtures/sample-git/.pi/flows/flows/e2e/synthetic/flow.yaml.
//
// F15: session menu Open flow… → pick → the flow slot shows the NOT-STARTED panel
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

    // Open flow… is a menu item (flows plugin → PLUGINS group). Wait for flows to be
    // available (the item appears once pi-flows has published), then activate it.
    await openSessionMenu(page, card);
    const open = flowMenuItem(page, /open flow/i);
    await expect(open).toBeVisible({ timeout: 60_000 });
    await expect(open).not.toHaveAttribute("aria-disabled", "true");
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

    await openSessionMenu(page, card);
    const runFlow = flowMenuItem(page, /run flow/i);
    await expect(runFlow).toBeVisible({ timeout: 60_000 });
    await expect(flowMenuItem(page, /open flow/i)).not.toHaveAttribute("aria-disabled", "true");
    await closeSessionMenu(page);

    // The faux flow can finish in well under a second, and the menu item exists
    // only while the menu is open: probe IN-PAGE the moment the live panel
    // appears — open THIS card's menu and record the Open flow… state the first
    // time the item is in the DOM.
    const sessionId = (await card.getAttribute("data-session-id")) as string;
    await page.evaluate((id) => {
      const w = window as unknown as Record<string, unknown>;
      w.__openWasDisabled = false;
      w.__probed = false;
      const trigger = () => document.querySelector(`[data-session-id="${id}"] [data-testid^="session-actions-trigger-"]`) as HTMLElement | null;
      const openItem = () => Array.from(document.querySelectorAll('[role="menuitem"]')).find((e) => /open flow/i.test(e.textContent ?? ""));
      new MutationObserver(() => {
        if (w.__probed) return;
        if (!document.querySelector('[data-testid="flow-dashboard"][data-flow-mode="live"]')) return;
        w.__probed = true;
        const watcher = new MutationObserver(() => {
          const item = openItem();
          if (!item) return;
          w.__openWasDisabled = item.getAttribute("aria-disabled") === "true";
          watcher.disconnect();
          trigger()?.click();
        });
        watcher.observe(document.body, { subtree: true, childList: true, attributes: true });
        trigger()?.click();
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    }, sessionId);

    await openSessionMenu(page, card);
    await flowMenuItem(page, /run flow/i).click();
    await pickSynthetic(page);
    await byTestId(page, "flowLaunchRun").click();

    // Completion → summary; the action re-enables.
    await expect(page.getByTestId("flow-summary-scrollbox")).toBeVisible({ timeout: 120_000 });
    await openSessionMenu(page, card);
    await expect(flowMenuItem(page, /open flow/i)).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    const wasDisabled = await page.evaluate(() => (window as unknown as { __openWasDisabled: boolean }).__openWasDisabled);
    expect(wasDisabled).toBe(true);
  });
});
