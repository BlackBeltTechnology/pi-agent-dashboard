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

    // Run from the idle header → launch dialog → submit.
    await panel.getByTestId("flow-idle-run").click();
    await byTestId(page, "flowLaunchRun").click();

    // The same (single) panel goes live: "not started" disappears.
    await expect(panel).toHaveAttribute("data-flow-mode", "live", { timeout: 60_000 });
    await expect(page.getByTestId("flow-dashboard")).toHaveCount(1);
    await expect(panel.getByText("not started")).toHaveCount(0);

    // Both steps finish → the slot forwards to the completed-flow summary.
    await expect(page.getByTestId("flow-summary-scrollbox")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("flow-dashboard")).toHaveCount(0);
  });

  test("F16: Open flow… disabled while a flow runs", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const runFlow = card.getByRole("button", { name: /run flow/i });
    await expect(runFlow).toBeVisible({ timeout: 60_000 });
    const open = card.getByTestId("flows-open-button");
    await expect(open).toBeEnabled();

    await runFlow.click();
    await pickSynthetic(page);
    await byTestId(page, "flowLaunchRun").click();

    await expect(open).toBeDisabled({ timeout: 30_000 });
    await expect(open).toBeEnabled({ timeout: 120_000 });
  });
});
