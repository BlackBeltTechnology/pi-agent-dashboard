/**
 * E2E: agent credential guard result in chat (change: encrypt-credentials-at-rest, test-plan F5).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the guard decision and its wiring into the bridge `tool_call`
 * hook. Only a live browser against a real server + real bridge + faux model proves
 * the user-visible outcome: the agent's `read` of the dashboard credential store is
 * refused with a `credential_guard` result shown on the tool card, the path gate
 * does NOT also raise its "outside its workspace" card for it (the guard runs
 * before, and instead of, the gate), and the turn still settles with no stuck spinner.
 *
 * Faux scenario `tool-read-credentials` (reads `~/.pi/agent/plugin-credentials.json`,
 * then a closing text). See qa/fixtures/faux-scenarios.ts.
 *
 * test-plan: #F5.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const GATE_TITLE = /outside its workspace/i;
const DONE_TEXT = "credential read done";

async function setGate(page: Page, enabled: boolean) {
  const res = await page.request.put("/api/config", { data: { agentPathGate: { enabled, timeoutSeconds: 120 } } });
  expect(res.ok()).toBe(true);
}

test.describe("agent credential guard (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await setGate(page, true);
  });
  test.afterEach(async ({ page }) => {
    await setGate(page, true).catch(() => undefined);
  });

  test("F5: a read of the credential store is blocked with credential_guard, no gate card, and the turn settles", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Record whether the path-gate card EVER rendered during the turn (a count check at the
    // end would miss a card that appeared and was answered/removed).
    await page.evaluate((src) => {
      const re = new RegExp(src, "i");
      const w = window as unknown as { __gateSeen: boolean };
      w.__gateSeen = false;
      new MutationObserver(() => {
        if (!w.__gateSeen && re.test(document.body.textContent ?? "")) w.__gateSeen = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    }, GATE_TITLE.source);

    await expect(page.getByText(GATE_TITLE)).toHaveCount(0);
    await sendPrompt(page, "[[faux:tool-read-credentials]] go");

    // The scripted closing text arrives after the (blocked) tool result.
    await expect(page.getByText(DONE_TEXT)).toBeVisible({ timeout: 30_000 });

    // The tool card converges to an error: the single read renders in a burst that flags 1 failed.
    const burst = page.getByTestId("tool-burst-group");
    await expect(burst).toHaveAttribute("data-running", "false", { timeout: 30_000 });
    await expect(page.getByTestId("tool-burst-failed-badge")).toBeVisible({ timeout: 15_000 });

    // The blocked result text is on the card. The burst auto-collapses when done and a member
    // may be collapsed, so expand only what is still hidden (guarded by the text, never a toggle loop).
    const guardText = page.getByText(/credential_guard/).first();
    await expect(async () => {
      if (!(await guardText.isVisible())) {
        if (!(await page.getByTestId("tool-burst-body").isVisible())) await page.getByTestId("tool-burst-header").click();
        if (!(await guardText.isVisible())) await page.getByTestId("tool-burst-body").getByRole("button").first().click();
      }
      await expect(guardText).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(guardText).toContainText("credential_guard");

    // The path gate never prompted for this read — at any point in the turn.
    await expect(page.getByText(GATE_TITLE)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __gateSeen: boolean }).__gateSeen)).toBe(false);

    // The turn settled: no stop control, composer back to send, no running burst.
    await expect(page.getByTestId("stop-button")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("send-button")).toBeVisible();
    await expect(page.locator('[data-testid="tool-burst-group"][data-running="true"]')).toHaveCount(0);
  });
});
