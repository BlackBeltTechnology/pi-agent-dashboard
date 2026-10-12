import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// L3 — docker smoke on the 1.1.0 lockstep floor.
//
// change: update-pi-core-1-1-adopt-apis (test-plan #F3).
//
// The harness image installs `@earendil-works/pi-coding-agent@<docker/Dockerfile
// pin>`, so this spec proves the whole floor move end to end: a session spawns
// and registers on pi 1.1.0, `/api/health` reports that pi as the running one
// (no below-floor error), and a faux `read` tool call completes with a visible
// duration on its row.
//
// The dashboard port is NEVER hardcoded: the `page` fixture baseURL comes from
// `.pi-test-harness.json#dashboardPort` (see fixtures.ts / global-setup.ts).
// Scenario args: qa/fixtures/faux-scenarios.ts → toolScenario("read", { path }).
const READ_PATH = "src/example.ts";
const FLOOR = "1.1.0";

test.describe("pi 1.1.0 floor smoke", () => {
  test.beforeEach(async ({ page }) => {
    // The container seeds NO display prefs; without toolCalls/toolResults no tool
    // group renders. Send a COMPLETE prefs object (see enhance-tool-call-grouping).
    const res = await page.request.patch("/api/preferences/display", {
      data: {
        reasoning: true,
        toolResults: true,
        toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true },
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("session registers on pi 1.1.0, health reports it, the tool row shows a duration", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:tool-read]] go");
    await expect(page.getByText(READ_PATH).first()).toBeVisible({ timeout: 30_000 });

    // /api/health: the running pi is the 1.1.0 floor and nothing is flagged.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/health");
          if (!res.ok()) return null;
          const body = (await res.json()) as { compatibility?: { current?: string; error?: string } | null };
          return body.compatibility ? { current: body.compatibility.current, error: body.compatibility.error } : null;
        },
        { timeout: 30_000, intervals: [500] },
      )
      .toEqual({ current: FLOOR, error: undefined });

    // The completed single-call group's header carries a duration: `NNNms` or
    // `N.Ns` (ToolBurstGroup.formatDuration), never an empty/running state.
    const header = page.getByTestId("tool-burst-header").first();
    // No trailing `\b`: the header text concatenates its spans ("…ts1ms1 failed").
    await expect(header).toContainText(/\d+(?:ms|\.\ds|s)/, { timeout: 30_000 });
  });
});
