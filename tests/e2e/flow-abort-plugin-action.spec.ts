import { expect, test } from "./fixtures.js";
import { chipRun, pickFlow, waitForFlowsChip } from "./helpers/flows-chip.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Abort end-to-end: the panel header Abort sends `plugin_action { pluginId:
 * "flows", action: "flow.abort" }` (never the retired `flow_control`), the
 * flows plugin relays `flow:abort`, and the panel converges to aborted.
 * See change: update-flows-plugin (D2; test-plan F7). Uses the baked `e2e:slow`
 * flow: one code step that waits up to 60 s and returns on abort.
 */
test.describe("flow abort via plugin_action (L3)", () => {
  test("F7: header Abort → plugin_action frame, no flow_control, panel converges to aborted", async ({ page }) => {
    test.setTimeout(240_000);
    const frames: string[] = [];
    page.on("websocket", (ws) => {
      ws.on("framesent", (f) => {
        if (typeof f.payload === "string") frames.push(f.payload);
      });
    });
    const card = await spawnFreshGitSession(page);
    await card.click();
    const sid = (await card.getAttribute("data-session-id")) ?? "";
    await page.evaluate((s) => localStorage.setItem(`dashboard:flow-dashboard-collapsed:${s}`, "false"), sid);

    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "slow");
    await byTestId(page, "flowLaunchRun").click();

    const abort = page.getByTitle("Abort flow");
    await expect(abort).toBeVisible({ timeout: 30_000 });
    await abort.click();

    await expect
      .poll(() => frames.some((p) => p.includes('"plugin_action"') && p.includes('"flow.abort"') && p.includes('"flows"')), {
        timeout: 10_000,
      })
      .toBe(true);
    expect(frames.some((p) => p.includes('"flow_control"'))).toBe(false);
    // Converges to the aborted terminal well before the 60 s wait would end.
    await expect(page.locator('[data-testid="flow-dashboard"][data-flow-mode="live"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("flow-summary-panel-toggle")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("flow-summary-panel-toggle").locator("xpath=..")).toContainText(/abort/i);
  });
});
