import { expect, type Page, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Flow graph draws the pi-flows engine order: segment fall-through edges, and
 * an `on_error` route kept beside the fall-through on the same pair.
 * See change: fix-flow-graph-engine-order (test-plan E26, E27).
 *
 * Fixtures: the EXISTING baked flows `e2e/slow` (`wait`, `after`: two code
 * steps) and `e2e/fanout` (`fan` agent `on_error: done`; `done` code is the
 * next segment). Attached idle through the same localStorage attachment the app
 * writes (pattern: `helpers/flow-card-grid.ts` `openIdleGrid`), so no engine
 * run — the idle graph renders from the real flow file.
 */

const FLOWS = "/fixtures/sample-git/.pi/flows/flows";

async function openIdleFlow(page: Page, flow: "slow" | "fanout") {
  const card = await spawnFreshGitSession(page);
  await card.click();
  const sid = (await card.getAttribute("data-session-id")) ?? "";
  expect(sid, "session id on the spawned card").not.toBe("");
  await page.evaluate(
    ([k, v, ck]) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ck, "false"); // panel expanded
    },
    [
      `dashboard:flow-attached:${sid}`,
      JSON.stringify({ id: `e2e-order-${flow}`, name: `e2e:${flow}`, source: `${FLOWS}/e2e/${flow}/flow.yaml`, baselineStartedAt: 0 }),
      `dashboard:flow-dashboard-collapsed:${sid}`,
    ],
  );
  await page.reload();
  const panel = page.getByTestId("flow-dashboard");
  await expect(panel).toHaveAttribute("data-flow-mode", "idle", { timeout: 30_000 });
  return panel;
}

test.describe("flow graph engine order (L3)", () => {
  test("E26: consecutive code steps draw a fall-through edge", async ({ page }) => {
    const panel = await openIdleFlow(page, "slow");
    await expect(panel.locator('[data-node="wait"]').first()).toBeVisible();
    await expect(panel.locator('[data-edge="wait>after"]').first()).toBeAttached();
  });

  test("E27: on_error handler on the next segment stays a normal node; error edge joins on toggle", async ({ page }) => {
    const panel = await openIdleFlow(page, "fanout");
    const toggle = panel.getByRole("button", { name: /error routes/ }).first();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Hidden layer: `done` is reached by fall-through, so it is a normal node.
    await expect(panel.locator('[data-node="done"]').first()).toBeVisible();
    await expect(panel.locator('[data-edge="fan>done"]')).toHaveCount(1);
    await expect(panel.locator('[data-edge="fan>done"][data-edge-kind="implicit"]')).toHaveCount(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Shown: a second, error-styled fan>done edge; `done` still a normal node.
    await expect(panel.locator('[data-edge="fan>done"]')).toHaveCount(2);
    await expect(panel.locator('[data-edge="fan>done"][data-edge-kind="on_error"]')).toHaveCount(1);
    await expect(panel.locator('[data-node="done"]').first()).toBeVisible();
  });
});
