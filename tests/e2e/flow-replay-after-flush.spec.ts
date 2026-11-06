import { expect, test } from "./fixtures.js";
import { chipRun, expandSummary, pickFlow, waitForFlowsChip } from "./helpers/flows-chip.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Plugin entry replay after pi's flush: a session with an assistant message
 * (so pi persists custom entries) runs `e2e:synthetic`; after a reload the flow
 * summary rebuilds from the persisted `flow-event` entries through the
 * MANIFEST-declared replay set — and no generic custom card shows them.
 * See change: update-flows-plugin (D3; test-plan F5; exemplar
 * custom-entry-replay-parity.spec.ts).
 */
async function agentStatuses(page: import("@playwright/test").Page): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const n of await page.locator("[data-node]").all()) {
    const id = await n.getAttribute("data-node");
    if (id) out[id] = await n.getAttribute("data-status");
  }
  return out;
}

test.describe("flow replay after flush (L3)", () => {
  test("F5: the same agents and statuses render after a reload; no flow-event custom card", async ({ page }) => {
    test.setTimeout(240_000);
    const card = await spawnFreshGitSession(page);
    const sid = (await card.getAttribute("data-session-id")) ?? "";
    await card.click();
    // An assistant message first: pi persists custom entries only after it
    // (on-demand-session-replay KNOWN BLOCKER).
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(/plain/i).first()).toBeVisible({ timeout: 60_000 });

    await waitForFlowsChip(page);
    await chipRun(page).click();
    await pickFlow(page, "synthetic");
    await byTestId(page, "flowLaunchRun").click();
    await expandSummary(page);
    await expect(page.locator('[data-node="alpha"]')).toHaveAttribute("data-status", "complete", { timeout: 60_000 });
    await expect(page.locator('[data-node="beta"]')).toHaveAttribute("data-status", "complete", { timeout: 60_000 });
    const live = await agentStatuses(page);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`).click();
    await expandSummary(page);
    await expect(page.locator('[data-node="beta"]')).toHaveAttribute("data-status", "complete", { timeout: 60_000 });
    expect(await agentStatuses(page)).toEqual(live);
    await expect(page.locator('[data-testid="custom-entry-card"]', { hasText: "flow-event" })).toHaveCount(0);
  });
});
