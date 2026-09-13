import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E — STUB GROUP EXPANDER & ENDED SESSION PAGING.
 *
 * Covers task 8.4 (Test F3) of change `fix-connect-snapshot-frame-loss`.
 *
 * - F3: Harness seeded with one dir whose only session ended before the
 *   window (PI_E2E_SEED fixture with > 120 ended sessions elsewhere).
 *   Trigger: click the stub group's ended expander → ended list grows by <= 50;
 *   "more" hidden once held count equals label.
 */

const STUB_DIR_CWD = "/fixtures/stub-dir";
const STUB_SESSION_ID = "019f0000-0000-7000-8000-000000000001";

test.describe("stub group expander & paging (F3)", () => {
  test("F3: clicking the stub group's ended expander pages ended sessions and hides 'more' when all held", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // 1. Arrange: Go to dashboard. Stub dir is seeded outside the window.
    await gotoDashboard(page);

    const header = page.getByTestId(`folder-home-row-${STUB_DIR_CWD}`);
    await expect(header).toBeVisible({ timeout: 30_000 });

    // The stub group header renders with an ended expander
    const expander = page.getByTestId(`folder-ended-toggle-${STUB_DIR_CWD}`);
    await expect(expander).toBeVisible({ timeout: 10_000 });

    // The label indicates 1 ended session (from seed-sessions-window.mjs)
    await expect(expander).toHaveText(/1 ended/i);

    // Initially, before expand, no session cards exist in the stub group
    const stubSessionCard = page.locator(`[data-session-id="${STUB_SESSION_ID}"]`);
    await expect(stubSessionCard).toHaveCount(0);

    // 2. Trigger: click the expander
    await expander.click();

    // Observable: ended list grows by <= 50 rows (here exactly 1 session seeded)
    await expect(stubSessionCard).toBeVisible({ timeout: 15_000 });

    // "More" affordance is hidden once held count equals the label count (1 === 1)
    const moreBtn = page.getByTestId(`folder-ended-more-${STUB_DIR_CWD}`);
    await expect(moreBtn).toHaveCount(0);
  });
});
