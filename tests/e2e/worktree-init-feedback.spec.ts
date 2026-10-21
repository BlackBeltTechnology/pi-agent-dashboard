import { expect, type Locator, type Page, test } from "./fixtures.js";
import { contrastFailures, measureText, nonTextFailures, setThemeMode } from "./helpers/computed-contrast.js";
import { byTestId, ensureGitSession, gotoDashboard, pinDirectory } from "./helpers/index.js";

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

/** The sortable pinned-folder group whose header shows `basename` (unique). */
function folderGroup(page: Page, basename: string): Locator {
  return page
    .locator('[data-testid="sortable-pinned-group"]')
    .filter({ hasText: basename });
}

/**
 * Pin a fixture dir. Establishes dashboard mode first so the sidebar
 * "Add Folder" affordance is present (not the onboarding CTA), then defers to
 * the shared helper.
 *
 * This used to hand-roll the flow to dodge the old PathPicker's flaky
 * exact-partial-match Select rule. `AddFoldersDialog` now commits the browsed
 * folder when nothing is selected, and the helper asserts the status line names
 * the exact path first — deterministic, so the duplication buys nothing. See
 * changes: project-scope-disable-global-resources, simplify-add-folder-picker.
 */
async function pinFixture(page: Page, cwd: string): Promise<void> {
  await ensureGitSession(page);
  await pinDirectory(page, cwd);
}

/**
 * Click Initialize, confirm the TOFU trust dialog, return the folder group.
 * `action` picks which affirmative to click (default "always" → persisted).
 */
async function trustAndRun(page: Page, basename: string, action: "session" | "always" = "always"): Promise<Locator> {
  const group = folderGroup(page, basename);
  const initBtn = group.getByTestId("worktree-init-btn");
  await expect(initBtn).toBeVisible({ timeout: 20_000 });
  await initBtn.click();
  // Untrusted hook → two-action trust dialog (change: add-session-scoped-init-trust).
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const testId = action === "session" ? "worktree-init-trust-session" : "worktree-init-trust-always";
  await dialog.getByTestId(testId).click();
  return group;
}

test.describe("worktree-init feedback", () => {
  // S14 (test-plan #S14): the untrusted dialog for sample-hook-ok is a one-shot
  // per container (trust is process-global; the gate flips once initialized), so
  // the two-action-dialog + session-path assertion folds into THIS test rather
  // than a colliding standalone one.
  test("S14 two-action dialog + session path streams a chip, survives a mid-run reload, then collapses", async ({ page }) => {
    await pinFixture(page, HOOK_OK);

    // Untrusted hook → two-action trust dialog: Cancel + both honest labels.
    const group = folderGroup(page, "sample-hook-ok");
    const initBtn = group.getByTestId("worktree-init-btn");
    await expect(initBtn).toBeVisible({ timeout: 20_000 });
    await initBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByTestId("worktree-init-trust-cancel")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Trust until dashboard restarts" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Always trust" })).toBeVisible();
    // Session action drives the run (S14: clicking the session action → done).
    await dialog.getByTestId("worktree-init-trust-session").click();

    // Running feedback is a status chip, NOT a raw terminal <pre>.
    await expect(group.getByTestId("worktree-init-chip")).toBeVisible({ timeout: 15_000 });
    // Full log is opt-in behind a collapsed disclosure (closed by default).
    const log = group.getByTestId("worktree-init-log");
    if (await log.count()) expect(await log.first().getAttribute("open")).toBeNull();

    // Reload MID-RUN (the hook sleeps ~5s): boot rehydration re-fetches
    // /active-inits and re-renders the chip for this cwd without user action.
    // The reload is the theme switch to base light (`setThemeMode` reloads), so
    // #F3 below measures the running banner in the light palette.
    // See change: fix-folder-card-pill-contrast (test-plan #F3).
    await setThemeMode(page, "light");
    await expect(folderGroup(page, "sample-hook-ok").getByTestId("worktree-init-chip")).toBeVisible({ timeout: 15_000 });

    // #F3: while running, the banner (info rung) text clears 4.5:1, the spinner
    // arc 3:1, and the preview line paints in the region's own colour.
    const running = folderGroup(page, "sample-hook-ok").getByTestId(`folder-banner-running-${HOOK_OK}`);
    await expect(running).toBeVisible({ timeout: 15_000 });
    expect(contrastFailures(await measureText(running), 4.5)).toEqual([]);
    expect(await nonTextFailures(running, 3)).toEqual([]);
    const ghost = running.getByTestId("worktree-init-ghost");
    if (await ghost.count()) {
      const [ghostColor, regionColor] = await Promise.all([
        ghost.evaluate((e) => getComputedStyle(e).color),
        running.evaluate((e) => getComputedStyle(e).color),
      ]);
      expect(ghostColor).toBe(regionColor);
    }
    // Converges to "Initialized" on the same (info) rung, then the banner detaches.
    await expect(running).toContainText("Initialized", { timeout: 30_000 });
    await expect(folderGroup(page, "sample-hook-ok").locator('[data-testid^="folder-banner-"]')).toHaveCount(0, { timeout: 15_000 });

    // Success collapses the feedback (chip gone AND no Initialize button — the
    // gate flipped). A FAILED run would keep the chip sticky, so chip-count-0
    // is the success signal.
    await expect(folderGroup(page, "sample-hook-ok").getByTestId("worktree-init-chip")).toHaveCount(0, { timeout: 30_000 });
    await expect(folderGroup(page, "sample-hook-ok").getByTestId("worktree-init-btn")).toHaveCount(0);
  });

  // S15 (test-plan #S15): sample-hook-fail is the untrusted-dialog consumer for
  // the "Always trust" (project) path. Its gate always needsInit, so after the
  // grant the row stays actionable — letting us prove the persisted grant holds
  // (re-run needs NO trust dialog) alongside the sticky-failure-chip assertion.
  test("S15 always-trust path runs, persists (no re-prompt), sticky retryable failure chip", async ({ page }) => {
    await pinFixture(page, HOOK_FAIL);

    // Click "Always trust" (project scope) on the untrusted hook.
    const group = await trustAndRun(page, "sample-hook-fail", "always");

    // Failure: plain-language chip + Retry, log opt-in.
    const err = group.getByTestId("worktree-init-error");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(group.getByTestId("worktree-init-retry")).toBeVisible();

    // Sticky: never auto-dismisses on a timer.
    await page.waitForTimeout(2_500);
    await expect(err).toBeVisible();

    // Retry re-issues the run WITHOUT a trust dialog — the "Always trust" grant
    // persisted (S15). Prove a NEW run started: the chip CLEARS then re-appears
    // on the next failure; assert no trust dialog surfaced in between.
    await group.getByTestId("worktree-init-retry").click();
    await expect(group.getByTestId("worktree-init-error")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(group.getByTestId("worktree-init-error")).toBeVisible({ timeout: 20_000 });
  });

  // F4 (test-plan #F4, change: fix-folder-card-pill-contrast): the failed run on
  // the error rung. Placed AFTER S15 — its "Always trust" grant persists, so this
  // run may or may not meet the trust dialog; it answers the dialog only if shown.
  test("F4 failed banner: text ≥ 4.5:1, log keeps code colours, toggle inherits, Retry on its own row", async ({ page }) => {
    await pinFixture(page, HOOK_FAIL);
    await setThemeMode(page, "light");
    const group = folderGroup(page, "sample-hook-fail");
    const initBtn = group.getByTestId("worktree-init-btn");
    await expect(initBtn).toBeVisible({ timeout: 20_000 });
    await initBtn.click();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dialog.getByTestId("worktree-init-trust-always").click();
    }

    const region = group.getByTestId(`folder-banner-failed-${HOOK_FAIL}`);
    await expect(region).toBeVisible({ timeout: 20_000 });
    await expect(group.getByTestId("worktree-init-error")).toBeVisible();
    expect(contrastFailures(await measureText(region), 4.5)).toEqual([]);

    // Open the log: the <pre> keeps `--text-secondary` on `--bg-code`; the
    // `View log` toggle inherits the region colour.
    const log = group.getByTestId("worktree-init-log");
    await log.locator("summary").click();
    const pre = log.locator("pre");
    await expect(pre).toBeVisible();
    const expected = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--text-secondary)";
      probe.style.backgroundColor = "var(--bg-code)";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const out = { color: cs.color, bg: cs.backgroundColor };
      probe.remove();
      return out;
    });
    const got = await pre.evaluate((e) => ({ color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
    expect(got).toEqual(expected);
    const [toggleColor, regionColor] = await Promise.all([
      log.locator("summary").evaluate((e) => getComputedStyle(e).color),
      region.evaluate((e) => getComputedStyle(e).color),
    ]);
    expect(toggleColor).toBe(regionColor);

    // Retry sits on its own row, below the summary block.
    const retryBox = await group.getByTestId("worktree-init-retry").boundingBox();
    const summaryBox = await group.getByTestId("worktree-init-error").boundingBox();
    expect(retryBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(retryBox!.y).toBeGreaterThanOrEqual(summaryBox!.y + summaryBox!.height - 1);
  });
});
