import { expect, test } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Scenario 5.4 (change: add-flow-plugin-e2e-tests) — a REAL-flow L3 regression.
//
// Per design D5 the harness lands with a SYNTHETIC 2-agent flow first
// (flow-roundtrip.spec.ts); a real flow (e.g. invoicebot) is added afterward as
// a world regression. A real flow couples the test to that flow's specific agent
// set, so it is OPT-IN: bake the real flow + its agents under the sample-git
// fixture (docker/fixtures/sample-git/.pi/flows/) and its agents' models to a
// role the faux role-preset maps to faux/faux-1, then run with:
//   PI_E2E_REAL_FLOW="<flow-name>" npm run test:e2e -- real-flow-regression
//
// The assertion mirrors flow-roundtrip: gate opens → agents render → flow
// completes. Skipped until a real flow is wired, so the standard managed run
// stays green while the regression hook is in place.
const REAL_FLOW = process.env.PI_E2E_REAL_FLOW;

test.describe("real-flow regression (L3, opt-in)", () => {
  test("real flow renders + completes end-to-end", async ({ page }) => {
    test.skip(!REAL_FLOW, "set PI_E2E_REAL_FLOW=<flow-name> with the flow baked into the harness");
    const flowName = REAL_FLOW as string;

    const card = await spawnFreshGitSession(page);
    await card.click();

    const runFlow = card.getByRole("button", { name: /run flow/i });
    await expect(runFlow).toBeVisible({ timeout: 60_000 });
    await runFlow.click();

    const search = page.getByPlaceholder("Search flows...");
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill(flowName);
    await page.getByText(flowName, { exact: false }).first().click();
    await byTestId(page, "flowLaunchRun").click();

    await expect(page.getByText("faux/faux-1").first()).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => (await card.textContent()) ?? "", { timeout: 90_000 })
      .toMatch(/success|error/i);
  });
});
