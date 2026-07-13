import { expect, type Locator, type Page, test } from "@playwright/test";
import { ensureGitSession, gotoDashboard, pinDirectory } from "./helpers/index.js";

// Level-1 E2E for the friendly worktree-init feedback (change: friendlier-worktree-init).
//
// The manual Initialize control is the deterministic driver for the SAME
// cwd-keyed store + chip surfaces the auto-on-spawn and refresh paths use. It
// exercises the browser-only integration the unit tests can't reach:
//   1. click Initialize on a hook fixture → trust-confirm → the run streams
//      into a status CHIP (not a raw <pre>);
//   2. page reload MID-RUN rehydrates the chip from GET /active-inits and keeps
//      streaming — then success collapses the feedback;
//   3. a failing hook renders a STICKY, retryable failure chip.
//
// Two baked git fixtures (docker/fixtures + test-entrypoint.sh):
//   /fixtures/sample-hook       gate needsInit, run sleeps ~5s then succeeds
//   /fixtures/sample-hook-fail  gate always needsInit, run exits 3 (fails)
//
// Both start UNTRUSTED, so the trust-confirm dialog gates the first run (TOFU).

const HOOK_OK = "/fixtures/sample-hook-ok";
const HOOK_FAIL = "/fixtures/sample-hook-fail";

/** The sortable pinned-folder group for `cwd` (scoped by its cwd-keyed testid). */
function folderGroup(page: Page, cwd: string): Locator {
  return page
    .locator('[data-testid="sortable-pinned-group"]')
    .filter({ has: page.getByTestId(`folder-urgency-sort-${cwd}`) });
}

/** Click Initialize, confirm the TOFU trust dialog, return the folder group. */
async function trustAndRun(page: Page, cwd: string): Promise<Locator> {
  const group = folderGroup(page, cwd);
  const initBtn = group.getByTestId("worktree-init-btn");
  await expect(initBtn).toBeVisible({ timeout: 20_000 });
  await initBtn.click();
  // Untrusted hook → trust-confirm dialog naming the gate + run command.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Run" }).click();
  return group;
}

test.describe("worktree-init feedback", () => {
  test("manual init streams a chip, survives a mid-run reload, then collapses on success", async ({ page }) => {
    // Establish dashboard mode first (spawns a no-hook sample-git session so the
    // onboarding LandingPage is gone) — then pinDirectory deterministically uses
    // the sidebar "Add Folder" path instead of the flip-prone onboarding CTA.
    await ensureGitSession(page);
    await pinDirectory(page, HOOK_OK);

    const group = await trustAndRun(page, HOOK_OK);

    // Running feedback is a status chip, NOT a raw terminal <pre>.
    await expect(group.getByTestId("worktree-init-chip")).toBeVisible({ timeout: 15_000 });
    // Full log is opt-in behind a collapsed disclosure (closed by default).
    const log = group.getByTestId("worktree-init-log");
    if (await log.count()) expect(await log.first().getAttribute("open")).toBeNull();

    // Reload MID-RUN (the hook sleeps ~5s): boot rehydration re-fetches
    // /active-inits and re-renders the chip for this cwd without user action.
    await gotoDashboard(page);
    await expect(folderGroup(page, HOOK_OK).getByTestId("worktree-init-chip")).toBeVisible({ timeout: 15_000 });

    // Success collapses the feedback (chip gone AND no Initialize button — the
    // gate flipped). A FAILED run would keep the chip sticky, so chip-count-0
    // is the success signal.
    await expect(folderGroup(page, HOOK_OK).getByTestId("worktree-init-chip")).toHaveCount(0, { timeout: 30_000 });
    await expect(folderGroup(page, HOOK_OK).getByTestId("worktree-init-btn")).toHaveCount(0);
  });

  test("a failing hook renders a sticky, retryable failure chip", async ({ page }) => {
    await ensureGitSession(page);
    await pinDirectory(page, HOOK_FAIL);

    const group = await trustAndRun(page, HOOK_FAIL);

    // Failure: plain-language chip + Retry, log opt-in.
    const err = group.getByTestId("worktree-init-error");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(group.getByTestId("worktree-init-retry")).toBeVisible();

    // Sticky: never auto-dismisses on a timer.
    await page.waitForTimeout(2_500);
    await expect(err).toBeVisible();

    // Retry re-issues the run (hook is now trusted → no dialog); it fails again.
    await group.getByTestId("worktree-init-retry").click();
    await expect(group.getByTestId("worktree-init-error")).toBeVisible({ timeout: 20_000 });
  });
});
