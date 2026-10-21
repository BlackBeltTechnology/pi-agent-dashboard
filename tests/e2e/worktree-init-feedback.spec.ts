import { expect, type Locator, type Page, test } from "./fixtures.js";
import {
  colorDistance,
  contrastFailures,
  contrastRatio,
  elementColors,
  measureText,
  nonTextFailures,
  overflowFailures,
  resolveColor,
  setThemeMode,
} from "./helpers/computed-contrast.js";
import {
  ensureGitSession,
  type FrameInjector,
  installFrameInjector,
  pinDirectory,
  stubActiveInits,
} from "./helpers/index.js";

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
  // Pins outlive the page (server-side preferences): a fixture pinned by an
  // earlier test is already there, and the dialog refuses to add it again.
  if (await folderGroup(page, cwd.split("/").pop() ?? cwd).isVisible()) return;
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
    // arc 3:1, and the preview line paints in the quiet `--text-secondary` body colour.
    const running = folderGroup(page, "sample-hook-ok").getByTestId(`folder-banner-running-${HOOK_OK}`);
    await expect(running).toBeVisible({ timeout: 15_000 });
    expect(contrastFailures(await measureText(running), 4.5)).toEqual([]);
    expect(await nonTextFailures(running, 3)).toEqual([]);
    const ghost = running.getByTestId("worktree-init-ghost");
    if (await ghost.count()) {
      // See change: fix-worktree-init-chip-overflow (test-plan #Q2).
      const [{ fg }, secondary] = await Promise.all([elementColors(ghost), resolveColor(page, "var(--text-secondary)")]);
      expect(colorDistance(fg, secondary)).toBeLessThan(2);
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

// ---------------------------------------------------------------------------
// Chip fits its banner + quiet body copy. The runs are STUBBED (rehydration
// endpoint + injected shell-WS frames) so the content is controlled: a 220-char
// line and a 150-char unbroken path are what real Maven/npm output produces.
// See change: fix-worktree-init-chip-overflow (test-plan #E6-#E8, #Q1).
// ---------------------------------------------------------------------------

const STUB_CWD = "/fixtures/kb-parent";
const LONG_LINE = "downloading artifact org.apache.maven.plugins:maven-compiler-plugin ".repeat(4).trim();
const LONG_PATH = `/Users/someone/${"deeply-nested-directory/".repeat(6)}file.jar`;
const DESKTOP = { width: 1280, height: 800 } as const;
const VIEWPORTS = [
  { name: "320", width: 320, height: 700 },
  { name: "390", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

/** Re-deliver until the page's (re)opened shell socket accepts it — frames are idempotent. */
async function deliver(inject: FrameInjector, frame: unknown): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          inject.send(frame);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

const progressFrame = { type: "worktree_init_progress", requestId: "", cwd: STUB_CWD, line: `${LONG_LINE}\n${LONG_PATH}` };
const failedFrame = {
  type: "worktree_init_failed",
  requestId: "",
  cwd: STUB_CWD,
  code: "script_nonzero_exit",
  message: LONG_PATH,
  stderr: LONG_PATH,
};

/** Pin the stubbed folder and return its group + frame injector (stub + injector installed before navigation). */
async function stubbedFolder(page: Page, viewport?: { width: number; height: number }): Promise<{ group: Locator; inject: FrameInjector }> {
  await stubActiveInits(page, [{ cwd: STUB_CWD, phase: "running", startedAt: Date.now() }]);
  const inject = await installFrameInjector(page);
  // `ensureGitSession`/`pinDirectory` drive desktop-only affordances: pin at the
  // desktop size, then narrow (the socket and store survive a resize).
  await page.setViewportSize(DESKTOP);
  await pinFixture(page, STUB_CWD);
  if (viewport) {
    // The mobile shell opens the selected session full-screen over the list;
    // reload at "/" so the folder list (where the banner lives) is on screen.
    await page.setViewportSize(viewport);
    await page.goto("/");
  }
  return { group: folderGroup(page, "kb-parent"), inject };
}

test.describe("worktree-init chip fits its banner", () => {
  for (const vp of VIEWPORTS) {
    test(`E6 running chip with long output stays inside the banner at ${vp.name}`, async ({ page }) => {
      const { group, inject } = await stubbedFolder(page, vp);
      const banner = group.getByTestId(`folder-banner-running-${STUB_CWD}`);
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await deliver(inject, progressFrame);
      await expect(banner.getByTestId("worktree-init-ghost")).toBeVisible();
      await banner.getByTestId("worktree-init-log").locator("summary").click();
      const pre = banner.getByTestId("worktree-init-log").locator("pre");
      await expect(pre).toBeVisible();

      expect(await overflowFailures(banner)).toEqual([]);
      const ghostClipped = await banner
        .getByTestId("worktree-init-ghost")
        .evaluate((e) => e.scrollWidth > e.clientWidth);
      expect(ghostClipped, "ghost line ellipsizes instead of widening the chip").toBe(true);
      const [preBox, bannerBox] = await Promise.all([pre.boundingBox(), banner.boundingBox()]);
      expect(preBox && bannerBox && preBox.x + preBox.width <= bannerBox.x + bannerBox.width + 0.5).toBe(true);
    });
  }

  for (const vp of VIEWPORTS.filter((v) => v.name !== "desktop")) {
    test(`E7 failed chip with an unbroken summary wraps inside the banner at ${vp.name}`, async ({ page }) => {
      const { group, inject } = await stubbedFolder(page, vp);
      await expect(group.getByTestId(`folder-banner-running-${STUB_CWD}`)).toBeVisible({ timeout: 20_000 });
      await deliver(inject, failedFrame);
      const banner = group.getByTestId(`folder-banner-failed-${STUB_CWD}`);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await banner.getByTestId("worktree-init-log").locator("summary").click();

      expect(await overflowFailures(banner)).toEqual([]);
      const msg = banner.getByTestId("worktree-init-message");
      const [msgBox, lineHeight] = await Promise.all([
        msg.boundingBox(),
        msg.evaluate((e) => Number.parseFloat(getComputedStyle(e).lineHeight) || 16),
      ]);
      expect(msgBox && msgBox.height > lineHeight * 1.5, "message wraps onto several lines").toBe(true);
      const [retryBox, bannerBox] = await Promise.all([
        banner.getByTestId("worktree-init-retry").boundingBox(),
        banner.boundingBox(),
      ]);
      expect(retryBox && bannerBox).toBeTruthy();
      expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(bannerBox!.x + bannerBox!.width + 0.5);
    });
  }

  for (const [vp, floor] of [
    [VIEWPORTS[1], 44],
    [VIEWPORTS[2], 32],
  ] as const) {
    test(`E8 Retry meets the tap-target floor (${floor} px) at ${vp.name}`, async ({ page }) => {
      const { group, inject } = await stubbedFolder(page, vp);
      await expect(group.getByTestId(`folder-banner-running-${STUB_CWD}`)).toBeVisible({ timeout: 20_000 });
      await deliver(inject, failedFrame);
      const retry = group.getByTestId(`folder-banner-failed-${STUB_CWD}`).getByTestId("worktree-init-retry");
      await expect(retry).toBeVisible({ timeout: 15_000 });
      const box = await retry.boundingBox();
      expect(box!.height, `Retry height at ${vp.name}`).toBeGreaterThanOrEqual(floor - 0.5);
    });
  }

  for (const [theme, mode] of [
    ["base", "light"],
    ["tokyo-night", "light"],
    ["catppuccin", "light"],
  ] as const) {
    test(`Q1 body copy is --text-secondary and AA in ${theme}/${mode}`, async ({ page }) => {
      const { group, inject } = await stubbedFolder(page);
      await setThemeMode(page, mode, theme);
      const running = folderGroup(page, "kb-parent").getByTestId(`folder-banner-running-${STUB_CWD}`);
      await expect(running).toBeVisible({ timeout: 20_000 });
      await deliver(inject, progressFrame);
      const secondary = await resolveColor(page, "var(--text-secondary)");

      for (const id of ["worktree-init-elapsed", "worktree-init-ghost"]) {
        const { fg, bg } = await elementColors(running.getByTestId(id));
        expect(colorDistance(fg, secondary), `${id} colour`).toBeLessThan(2);
        expect(contrastRatio(fg, bg), `${id} contrast`).toBeGreaterThanOrEqual(4.5);
      }
      await running.getByTestId("worktree-init-log").locator("summary").click();
      const log = running.getByTestId("worktree-init-log");
      const [pre, codeBg, regionColor] = await Promise.all([
        elementColors(log.locator("pre")),
        resolveColor(page, "var(--bg-code)"),
        running.evaluate((e) => getComputedStyle(e).color),
      ]);
      expect(colorDistance(pre.fg, secondary), "<pre> colour").toBeLessThan(2);
      expect(colorDistance(pre.bg, codeBg), "<pre> background").toBeLessThan(2);
      const summary = log.locator("summary");
      const style = await summary.evaluate((e) => {
        const cs = getComputedStyle(e);
        return { size: cs.fontSize, deco: cs.textDecorationLine, color: cs.color };
      });
      expect(style.size).toBe("12px");
      expect(style.deco).toContain("underline");
      expect(style.color).toBe(regionColor);

      await deliver(inject, failedFrame);
      const failedBanner = group.getByTestId(`folder-banner-failed-${STUB_CWD}`);
      await expect(failedBanner).toBeVisible({ timeout: 15_000 });
      const { fg, bg } = await elementColors(failedBanner.getByTestId("worktree-init-message"));
      expect(colorDistance(fg, secondary), "message colour").toBeLessThan(2);
      expect(contrastRatio(fg, bg), "message contrast").toBeGreaterThanOrEqual(4.5);
    });
  }
});
