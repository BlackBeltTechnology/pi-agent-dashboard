import { expect, test } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Scenario 5.1 (change: add-flow-plugin-e2e-tests) — L3 full-stack activation +
// render against the REAL pi-flows engine.
//
// The managed container boots with PI_TEST_PEERS=both (tests/e2e/global-setup.ts)
// so the pi-flows engine is loaded from settings.json#packages[] and discovers
// the synthetic 2-agent flow baked under
// /fixtures/sample-git/.pi/flows/flows/e2e/synthetic.yaml. Its agents use
// `model: @coding`, which the faux role-preset (providers.json, seeded by
// test-entrypoint.sh) resolves to faux/faux-1 — so the flow runs the real engine
// (DAG schedule, agent spawn, model:resolve, finish, blockedBy ordering) with a
// key-free deterministic model. Each agent's rendered task carries the
// `[[faux:flow-agent-branch]]` sentinel, so the faux provider replays a per-agent
// finish() keyed off the agent's system-prompt marker.
//
// Assertions cover the three activation/resolution signals the render-only
// harness misses: (1) the availability gate opens (the "Run Flow…" launcher only
// appears once flows_list arrives), (2) a FlowAgentCard renders (agents resolved
// + flow_* events forwarded + reduced), and (3) the flow reaches a terminal
// success state in the UI.
test.describe("flow roundtrip (L3: real pi-flows engine + faux agents)", () => {
  test("launch synthetic flow → agents render → flow completes", async ({ page }) => {
    const card = await spawnFreshGitSession(page);

    // Select the session so the FlowDashboard content-view has a target.
    await card.click();

    // (1) Availability gate: pi-flows discovered the synthetic flow → the
    // "Run Flow…" launcher renders on the session-card action bar.
    const runFlow = card.getByRole("button", { name: /run flow/i });
    await expect(runFlow).toBeVisible({ timeout: 60_000 });
    await runFlow.click();

    // Pick the synthetic flow from the searchable-select dialog.
    const search = page.getByPlaceholder("Search flows...");
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("synthetic");
    await page.getByText("synthetic", { exact: false }).first().click();

    // Launch (task optional — the flow's step tasks carry the faux sentinel).
    await byTestId(page, "flowLaunchRun").click();

    // (2) FlowAgentCard mounts in the flow content-view — agents resolved to
    // faux/faux-1 (rendered as the card's model line).
    await expect(page.getByText("faux/faux-1").first()).toBeVisible({ timeout: 60_000 });

    // (3) Flow reaches a terminal success state. The FlowActivityBadge on the
    // card flips from "running" to the terminal status once flow_complete
    // reduces; both agents reach a terminal state (2/2).
    await expect(card.getByText(/synthetic/i).first()).toBeVisible();
    await expect
      .poll(async () => (await card.textContent()) ?? "", { timeout: 60_000 })
      .toMatch(/success|2\/2/i);
  });
});
