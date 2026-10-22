import { expect, test } from "./fixtures.js";
import { launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E - terminal cap refusal (change: harden-server-capability-bounds, test-plan #F8).
//
// With the harness booted with a tiny global PTY cap, the third "+ Terminal" is
// refused: the server starts nothing and the requesting socket gets
// `terminal_limit_reached`, which the editor pane renders as a dismissible
// `role="status"` notice. Closing a terminal frees a slot; the next "+" succeeds
// and the notice clears. Only a live browser + server + PTY proves the whole loop
// (the cap itself, the targeted message, the notice slot, the clear-on-spawn rule).
//
// Variant harness: the cap is global, so it needs a DEDICATED boot with no other
// terminals alive, and it cannot be a shared default (other specs open many
// terminals). Locally opt in with:
//   PI_E2E_SEED=1 PI_E2E_TERMINALS_MAX_CONCURRENT=2 docker/test-up.sh -d --build
test.skip(
  process.env.PI_E2E_TERMINALS_MAX_CONCURRENT !== "2",
  "variant harness: runs on the `e2e-bounds-variants` CI leg (PI_E2E_TERMINALS_MAX_CONCURRENT=2); see .github/workflows/ci-e2e-browser.yml",
);

test.describe("terminal cap", () => {
  test("a refused + Terminal shows a notice; closing one frees a slot and clears it", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    const editorPane = page.getByTestId("split-editor-pane");
    await expect(editorPane).toBeVisible();

    const notice = editorPane.getByTestId("terminal-limit-notice");
    const tabs = editorPane.getByRole("tab");

    // Two terminals fit under the cap of 2.
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(1, { timeout: 30_000 });
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(2, { timeout: 30_000 });
    await expect(notice).toHaveCount(0);

    // The third is refused: a polite status notice naming the limit; still 2 tabs.
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(notice.getByRole("status")).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("2 terminals are open");
    await expect(tabs).toHaveCount(2);

    // Closing one frees a slot; the next "+" succeeds and the stale notice clears.
    const first = tabs.first();
    await first.hover();
    await first.getByRole("button").first().click();
    await expect(tabs).toHaveCount(1, { timeout: 20_000 });
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(2, { timeout: 30_000 });
    await expect(notice).toHaveCount(0);
  });
});
