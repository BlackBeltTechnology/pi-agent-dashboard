import { expect, test } from "./fixtures.js";
import {
  awaitBackfillResults,
  buildWindowedSession,
  clickLoadEarlierWithoutScrolling,
  climbToDivider,
  divider,
  installAnchorProbe,
  loadEarlier,
  nudgeAscent,
  openWindowedSession,
  pinDividerToTop,
  readAnchorSnapshot,
  rowTop,
  scroller,
  settleClickTarget,
  settledDividerY,
  settledScrollTop,
  teardownWindowedSession,
  type WindowedSession,
  watchBackfillFrames,
} from "./helpers/windowed-session.js";

/**
 * L3 gate for D7a — the `tail-only` splice anchor. Test-plan rows F9, F10, F18
 * (change: add-tail-only-replay-window).
 *
 * ── What D7a claims, and why it needs a real browser ────────────────────────
 * `fix-lazy-history-backfill-ux` (D6) removed scroll anchoring on the grounds
 * that events splice BELOW the divider, so nothing above the reading position
 * moves and `scrollTop` is the invariant. That holds while the divider is
 * mid-transcript. In `tail-only` the divider is the FIRST row, so the spliced
 * rows land between the loading head and everything else: "leave `scrollTop`
 * alone" pins the user to the head while the content they asked for accumulates
 * below, and — with the rising-edge rule — proximity never lapses, so the walk
 * stalls.
 *
 * So the two modes must NOT share the branch, which is the whole point of F10
 * sitting beside F9 in this file: each mode is asserted against the other's
 * behaviour, and a regression that collapses them into one branch turns one of
 * the two red whichever way it collapses.
 *
 * ── How the invariant is stated ─────────────────────────────────────────────
 * By the ROW, which is what D7a actually names.
 *
 * An earlier draft asserted the geometric proxy `Δ scrollTop === Δ scrollHeight`
 * instead, reasoning that absorbing the spliced height is the same as holding
 * the row. It is NOT, and the harness said so: the proxy left a ~3200px
 * residual on a 34000px splice even with a correct anchor, because
 * `scrollHeight` also grows when rows BELOW the viewport remeasure away from
 * their estimates. That growth moves nothing the user is looking at, and an
 * implementation that absorbed it would be over-correcting — so the proxy
 * fails a correct implementation and passes an over-correcting one. Exactly
 * backwards.
 *
 * The row is addressed through `data-row-key`, which carries the row's message
 * id and therefore survives a splice that shifts every `data-index`. That
 * attribute exists for the IMPLEMENTATION (the anchor re-locates its row
 * through it after the coarse correction remounts it), not for this test; the
 * test reuses a real product handle rather than introducing a test-only one.
 *
 * `head-tail` asserts the complementary property: `Δ scrollTop === 0`.
 *
 * ── Tolerance is a requirement, not a fudge ─────────────────────────────────
 * D7a says so explicitly: with `overflowAnchor: "none"` and a virtualizer whose
 * spliced rows carry ESTIMATED sizes until measured, the height at commit is an
 * estimate and the anchor keeps correcting until measurement settles. The
 * invariant is a BOUNDED DRIFT, not a fixed pixel. `DRIFT_TOLERANCE_PX` is
 * therefore generous relative to the ≤8px scroll tolerance the sibling
 * `head-tail` rows use — those measure a quantity that does not move at all.
 *
 * See change: add-tail-only-replay-window (D7a); fix-lazy-history-backfill-ux (D6).
 */

/**
 * Bound on the anchor residual once measurement has settled.
 *
 * Non-vacuity is what makes this number safe: the splice grows `scrollHeight`
 * by MANY thousands of px (the sibling spec measured 4309 → 40883 for one
 * max-span slice), and every test below asserts that growth explicitly. A
 * regression that skips the anchor entirely leaves a residual equal to the FULL
 * spliced height — three orders of magnitude outside this bound, not a near
 * miss. The tolerance absorbs estimate convergence; it cannot absorb a missing
 * implementation.
 */
const DRIFT_TOLERANCE_PX = 120;

let session: WindowedSession;

test.describe.configure({ mode: "serial" });

test.describe("tail-only — the splice anchors on the first previously-loaded row (D7a)", () => {
  test.setTimeout(300_000);

  test.beforeAll(async ({ browser }) => {
    // `test.setTimeout` at describe scope does NOT reach hooks (they keep the
    // 60s default), and this hook builds a whole transcript AND restarts the
    // daemon. Raise it here or the file fails in setup, not in an assertion.
    test.setTimeout(1_500_000);
    session = await buildWindowedSession(browser, { mode: "tail-only" });
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    // RESTORE the shared harness. A leftover window — or worse, a leftover
    // `tail-only` mode — would silently reshape every later spec's replay,
    // which presents as unrelated mass failure.
    //
    // Guarded: `afterAll` still runs when `beforeAll` failed, and an unguarded
    // teardown then throws on the unset session and MASKS the real setup error
    // with a `Cannot read properties of undefined` trace.
    if (!session) return;
    await teardownWindowedSession(browser, session);
  });

  /**
   * The premise every other test here rests on. Asserted separately so a
   * harness that failed to window, or failed to apply `tail-only`, reports THAT
   * rather than presenting as a splice or scroll failure.
   *
   * `headEnd === 0` is the wire-level signature of `tail-only`: the whole budget
   * went to the tail, so there is no protected head segment above the gap.
   */
  test("premise: the session replays tail-only and discloses a head-free gap", async ({ page }) => {
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session.sessionId);

    await expect
      .poll(() => frames.received.filter((m) => m.type === "history_window").length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);

    const win = frames.received.find((m) => m.type === "history_window") as Record<string, unknown>;
    expect(win.windowShape).toBe("tail-only");
    // Head-free: nothing above the gap. This is what makes the divider the
    // FIRST row and is the precondition D7a exists for.
    expect(win.headMaxSeq).toBe(0);
    await expect(divider(page)).toBeVisible();
  });

  /**
   * F9 — the anchor itself.
   *
   * Three properties, and all three are needed: the anchor holds (residual
   * bounded), the loading head actually LEAVES the proximity band as a result
   * (which is what re-arms the rising edge), and a subsequent ascent produces a
   * SECOND request (which is what proves the walk does not stall — the failure
   * D7a was written to prevent).
   */
  test("F9: the auto-loaded splice holds the anchor row, frees the head, and the walk continues", async ({
    page,
  }) => {
    // 10 min: this row does TWO full backfill round trips against a transcript
    // the first splice makes ~10x taller.
    test.setTimeout(600_000);

    /**
     * The splice here is issued by the AUTO-LOAD trigger, not by a click.
     * Climbing to the divider is a genuine user ascent as far as the product is
     * concerned — the harness writes `scrollTop` through `evaluate`, which
     * carries no `programmaticScrollUntil` stamp — so proximity fires the
     * trigger on its own. That is the path this mode actually uses, so it is
     * the path asserted.
     *
     * The probe (installed before navigation) captures the anchor geometry
     * synchronously inside `WebSocket.send`, which removes the race a
     * test-side \"just before the splice\" snapshot would have.
     */
    await installAnchorProbe(page);
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session.sessionId);

    /**
     * Nudge AFTER the affordance has armed, rather than relying on the opening
     * ascent.
     *
     * The trigger evaluates once, at the settle timer's expiry. During the
     * opening climb that expiry lands while the gap is still disarmed (the
     * client holds backfill until the terminal replay batch, D11), so the
     * evaluation correctly returns false \u2014 and nothing re-evaluates until
     * another scroll event arrives. Waiting for a frame without this nudge
     * simply times out, which is what the first run of this row did.
     */
    await expect(loadEarlier(page)).toBeEnabled({ timeout: 120_000 });
    await nudgeAscent(page);

    // Wait for the frame to actually go out, so a failure here reads as "the
    // trigger never fired" rather than as a bogus anchor measurement.
    await expect
      .poll(() => frames.sent.length, { timeout: 120_000 })
      .toBeGreaterThan(0);
    await awaitBackfillResults(page, frames);

    const snap = await readAnchorSnapshot(page);
    expect(snap, "the probe captured an anchor row at request time").toBeTruthy();

    // Let the virtualizer MEASURE the spliced rows. D7a requires the anchor to
    // keep correcting across that window rather than being consumed by one
    // layout pass. Settled on `scrollTop`, not the divider: the anchor's own
    // success condition is that the head leaves the viewport, at which point a
    // divider-settling wait could never converge.
    expect(await settledScrollTop(page), "the anchor stopped correcting").not.toBeNull();
    await page.waitForTimeout(2_000);

    const el = scroller(page);
    const after = await el.evaluate((n) => ({
      scrollTop: n.scrollTop,
      scrollHeight: n.scrollHeight,
    }));

    // NON-VACUITY: a held position means nothing unless a large insertion
    // actually happened. Assert growth FIRST, so a splice that delivered
    // nothing fails as "nothing spliced" rather than as a perfect anchor.
    expect(
      after.scrollHeight - snap!.scrollHeight,
      "the splice grew the transcript substantially",
    ).toBeGreaterThan(1_000);
    // ...and the anchor ACTED, rather than the row never having been displaced.
    expect(
      after.scrollTop - snap!.scrollTop,
      "the anchor scrolled to absorb the insertion",
    ).toBeGreaterThan(1_000);

    /**
     * THE INVARIANT — the first previously-loaded row holds its viewport
     * position. Re-located by `data-row-key`, because its `data-index` shifted
     * by the spliced row count.
     *
     * An unmounted row is a FAILURE, not a skip: the point of the anchor is
     * that this row stays where the user was looking.
     */
    const top = await rowTop(page, snap!.key);
    expect(top, "the anchor row is still mounted in the viewport").not.toBeNull();
    expect(
      Math.abs(top! - snap!.top),
      `the anchor row moved from ${snap!.top}px to ${top}px`,
    ).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);

    /**
     * The walk CONTINUES. The anchor pushes the loading head out of the
     * proximity band, which is exactly what re-arms the rising edge — so a
     * fresh ascent must be able to produce another request. A partial
     * implementation that left the user pinned to the head stalls here, which
     * is the failure D7a exists to prevent.
     *
     * Skipped when the first slice already drained the gap: reaching the floor
     * is a legitimate terminal state, not a stalled walk, and asserting a
     * second request against it would be asserting a bug.
     */
    if ((await divider(page).count()) > 0 && (await loadEarlier(page).count()) > 0) {
      const sentBefore = frames.sent.length;
      await climbToDivider(page);
      await expect
        .poll(() => frames.sent.length, { timeout: 120_000 })
        .toBeGreaterThan(sentBefore);
    }
  });

  /**
   * F10 — the SAME splice in `head-tail` must keep `fix-lazy`'s behaviour.
   *
   * This is the row that stops D7a being implemented as an unconditional
   * anchor. It rebuilds the window in `head-tail` against the same session, so
   * the only difference between it and F9 is the mode.
   */
  test("F10: the same splice in head-tail leaves scrollTop alone", async ({ page, browser }) => {
    test.setTimeout(600_000);
    const { writeLimits, WINDOW } = await import("./helpers/windowed-session.js");
    // Reshape the window WITHOUT rebuilding the transcript — same session, same
    // rows, different mode.
    const ctx = await browser.newContext();
    const cfgPage = await ctx.newPage();
    try {
      await writeLimits(cfgPage, {
        ...session.originalLimits,
        maxReplayEvents: WINDOW,
        replayWindowMode: "head-tail",
      });
    } finally {
      await ctx.close();
    }

    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session.sessionId, { requireLoadButton: true });
    // Premise: this really is the other shape, or the assertion below is
    // asserting `tail-only` behaviour under a `head-tail` name.
    await expect
      .poll(() => frames.received.filter((m) => m.type === "history_window").length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const win = frames.received.find((m) => m.type === "history_window") as Record<string, unknown>;
    expect(win.windowShape).toBe("head-tail");
    expect(win.headMaxSeq, "head-tail protects a head segment").toBeGreaterThan(0);

    await pinDividerToTop(page);
    await settleClickTarget(page);
    const el = scroller(page);
    expect(await settledDividerY(page)).not.toBeNull();
    const before = await el.evaluate((n) => ({
      scrollTop: n.scrollTop,
      scrollHeight: n.scrollHeight,
    }));

    await clickLoadEarlierWithoutScrolling(page);
    await awaitBackfillResults(page, frames);
    // The divider DOES stay put in this mode, so settling on it is correct here
    // — and is the stronger wait, since it also covers row remeasurement.
    await settledDividerY(page);
    await page.waitForTimeout(2_000);

    const after = await el.evaluate((n) => ({
      scrollTop: n.scrollTop,
      scrollHeight: n.scrollHeight,
    }));
    // Same non-vacuity gate as F9 — content really did arrive.
    expect(after.scrollHeight - before.scrollHeight).toBeGreaterThan(1_000);
    // `fix-lazy` D6's invariant, unchanged: nothing above the reading position
    // moved, so the correct correction is NONE.
    expect(after.scrollTop).toBe(before.scrollTop);

    // Put the harness back into `tail-only` for the row that follows.
    const ctx2 = await browser.newContext();
    const restore = await ctx2.newPage();
    try {
      await writeLimits(restore, {
        ...session.originalLimits,
        maxReplayEvents: WINDOW,
        replayWindowMode: "tail-only",
      });
    } finally {
      await ctx2.close();
    }
  });

  /**
   * F18 — the INVERSE of `fix-lazy`'s F4.
   *
   * In `head-tail` the selection-anchor compensator must be SUPPRESSED across a
   * splice: the rows land below the selection, so a correction would move the
   * one commit that must not move. In `tail-only` the rows land ABOVE the
   * selection, which genuinely displaces it — so the compensator must stay
   * ACTIVE and hold the selected text at its viewport position.
   *
   * Asserting the selection's own rect, not `scrollTop`: `scrollTop` MUST move
   * here (that is F9), so it cannot also be the invariant. What must hold still
   * is the selected content.
   */
  test("F18: a held selection keeps its viewport position while the head fills", async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session.sessionId);
    // The opening ascent may already have auto-loaded once. Let it finish, so
    // the selection below is established against a settled transcript rather
    // than mid-splice.
    await settledScrollTop(page);

    // Nothing left to fill means nothing to assert \u2014 reaching the floor is a
    // legitimate terminal state, not a failure of the compensator.
    test.skip(
      (await divider(page).count()) === 0 || (await loadEarlier(page).count()) === 0,
      "the gap drained on the opening ascent; no further splice to hold a selection across",
    );

    // Hold a real selection over a mounted transcript row, and capture where it
    // sits on screen.
    const selected = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="chat-scroll-container"]');
      const dividerRow = scroll
        ?.querySelector('[data-testid="history-gap-divider"]')
        ?.closest("[data-index]") as HTMLElement | null;
      if (!scroll || !dividerRow) return null;
      /**
       * Select a real TRANSCRIPT row, never the divider's own row.
       *
       * The divider renders the REMAINING GAP COUNT, which legitimately changes
       * when the gap shrinks — observed here as "504 earlier messages" becoming
       * "4 earlier messages". A selection held over that row then compares
       * unequal because its CONTENT changed, not because the selection moved:
       * a false failure about the very property this row exists to prove.
       */
      const di = Number(dividerRow.dataset.index);
      let best: HTMLElement | null = null;
      let bi = Number.POSITIVE_INFINITY;
      for (const n of Array.from(scroll.querySelectorAll<HTMLElement>("[data-index]"))) {
        const i = Number(n.dataset.index);
        if (Number.isFinite(i) && i > di && i < bi && n.textContent?.trim()) {
          best = n;
          bi = i;
        }
      }
      if (!best) return null;
      const range = document.createRange();
      range.selectNodeContents(best);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return sel?.toString() ?? null;
    });
    expect(selected, "a selection was established over a transcript row").toBeTruthy();

    const rectBefore = await page.evaluate(() => {
      const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return r ? { top: r.top } : null;
    });
    expect(rectBefore).toBeTruthy();

    const el = scroller(page);
    const heightBefore = await el.evaluate((n) => n.scrollHeight);
    const sentBefore = frames.sent.length;

    /**
     * Arm the trigger with a small UN-STAMPED nudge rather than clicking.
     *
     * A click would move focus and can collapse the selection this row exists
     * to observe; the nudge is also the honest gesture for this mode, where
     * loads are issued by proximity rather than by pressing anything. Keeping
     * it small leaves the selected row mounted and on screen.
     */
    await nudgeAscent(page);
    await expect
      .poll(() => frames.sent.length, { timeout: 120_000 })
      .toBeGreaterThan(sentBefore);
    await awaitBackfillResults(page, frames, sentBefore + 1);
    expect(await settledScrollTop(page), "the anchor stopped correcting").not.toBeNull();
    await page.waitForTimeout(2_000);

    // Non-vacuity: content arrived above the selection.
    expect(await el.evaluate((n) => n.scrollHeight)).toBeGreaterThan(heightBefore + 1_000);

    // The selection still holds the same text...
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? null)).toBe(selected);

    /**
     * ...and the compensator held it in place. This is the INVERSE of
     * `fix-lazy`'s F4: there the compensator must be SUPPRESSED across a splice
     * (rows land below the selection, so any correction is wrong); here the
     * rows land ABOVE it and genuinely displace it, so the compensator must
     * stay ACTIVE. Without it the selected content slides by the full spliced
     * height.
     *
     * Asserted on the selection's own rect, not `scrollTop` \u2014 `scrollTop` MUST
     * move here (that is F9), so it cannot also be the invariant.
     */
    const rectAfter = await page.evaluate(() => {
      const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return r ? { top: r.top } : null;
    });
    expect(rectAfter).toBeTruthy();
    expect(
      Math.abs(rectAfter!.top - rectBefore!.top),
      "the selected content held its viewport position",
    ).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
  });
});
