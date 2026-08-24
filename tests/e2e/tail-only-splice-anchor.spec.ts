import { expect, test } from "./fixtures.js";
import {
  awaitBackfillResults,
  buildWindowedSession,
  clickLoadEarlierWithoutScrolling,
  divider,
  openWindowedSession,
  pinDividerToTop,
  scrollDividerIntoDom,
  scroller,
  settleClickTarget,
  settledDividerY,
  settledScrollTop,
  teardownWindowedSession,
  watchBackfillFrames,
  type WindowedSession,
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
  test("F9: the anchor row holds its viewport position, the head leaves proximity, and the walk continues", async ({
    page,
  }) => {
    // 10 min, not the file's 5: this row does TWO full backfill round trips and
    // has to climb a transcript that the first splice made ~10x taller. The
    // climb is the expensive half — measured against the harness, the anchor
    // assertions land well inside 5 min but the walk phase does not.
    test.setTimeout(600_000);
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session.sessionId);
    await pinDividerToTop(page);
    await settleClickTarget(page);

    const el = scroller(page);
    // Baseline must be SETTLED and taken AFTER the click target has been
    // scrolled into place, or the virtualizer's estimate convergence and
    // Playwright's own pre-click scroll are both charged to the splice.
    expect(await settledDividerY(page), "the divider settled before the click").not.toBeNull();
    const before = await el.evaluate((n) => ({
      scrollTop: n.scrollTop,
      scrollHeight: n.scrollHeight,
    }));
    const dividerYBefore = await divider(page).boundingBox();
    expect(dividerYBefore).toBeTruthy();

    /**
     * THE ANCHOR ROW: the first previously-loaded row, i.e. the mounted row
     * immediately below the gap divider. Captured the same way the product
     * captures it, so the test and the implementation agree on WHICH row is
     * supposed to hold still.
     */
    const anchorBefore = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="chat-scroll-container"]');
      const dividerRow = scroll
        ?.querySelector('[data-testid="history-gap-divider"]')
        ?.closest("[data-index]") as HTMLElement | null;
      if (!scroll || !dividerRow) return null;
      const dividerIndex = Number(dividerRow.dataset.index);
      let best: HTMLElement | null = null;
      let bestIndex = Number.POSITIVE_INFINITY;
      for (const node of Array.from(
        scroll.querySelectorAll<HTMLElement>("[data-index]"),
      )) {
        const i = Number(node.dataset.index);
        if (Number.isFinite(i) && i > dividerIndex && i < bestIndex) {
          best = node;
          bestIndex = i;
        }
      }
      return best?.dataset.rowKey
        ? { key: best.dataset.rowKey, top: best.getBoundingClientRect().top }
        : null;
    });
    expect(anchorBefore, "an anchor row was identifiable below the divider").toBeTruthy();

    await clickLoadEarlierWithoutScrolling(page);
    await awaitBackfillResults(page, frames);

    /**
     * Let the virtualizer MEASURE the spliced rows. D7a requires the anchor to
     * keep correcting across that window rather than being consumed by a single
     * layout pass, so the assertion is deliberately taken AFTER settling — a
     * one-shot correction drifts back out of bound here.
     *
     * Settled on `scrollTop`, NOT on the divider: this test's own success
     * condition is that the anchor scrolls the loading head out of the
     * viewport, at which point the virtualizer unmounts it and a
     * divider-settling wait can never converge. Waiting on the row that is
     * supposed to leave would time out on exactly the runs that PASS.
     */
    expect(await settledScrollTop(page), "the anchor stopped correcting").not.toBeNull();
    await page.waitForTimeout(2_000);

    const after = await el.evaluate((n) => ({
      scrollTop: n.scrollTop,
      scrollHeight: n.scrollHeight,
    }));

    // NON-VACUITY first: a held position is only meaningful if a large
    // insertion actually happened. Assert the growth BEFORE the residual, so a
    // splice that silently delivered nothing fails as "nothing spliced" rather
    // than as a spuriously perfect anchor.
    const grown = after.scrollHeight - before.scrollHeight;
    expect(grown, "the splice grew the transcript substantially").toBeGreaterThan(1_000);

    // The anchor ACTED: a large downward correction happened. Without this a
    // stationary row would also satisfy the invariant below by simply never
    // having been displaced (e.g. nothing spliced above it).
    const moved = after.scrollTop - before.scrollTop;
    expect(moved, "the anchor scrolled to absorb the insertion").toBeGreaterThan(1_000);

    /**
     * THE INVARIANT — the first previously-loaded row holds its viewport
     * position. Re-located by `data-row-key`, because its `data-index` has
     * shifted by the spliced row count.
     *
     * A row that the virtualizer has unmounted is a FAILURE here, not a skip:
     * the whole point of the anchor is that this row stays where the user was
     * looking, so its absence means it was carried out of the viewport.
     */
    const anchorAfter = await page.evaluate((key: string) => {
      const node = document.querySelector<HTMLElement>(
        `[data-row-key="${CSS.escape(key)}"]`,
      );
      return node?.isConnected ? { top: node.getBoundingClientRect().top } : null;
    }, anchorBefore!.key);
    expect(anchorAfter, "the anchor row is still mounted in the viewport").toBeTruthy();
    expect(
      Math.abs(anchorAfter!.top - anchorBefore!.top),
      `the anchor row moved from ${anchorBefore!.top}px to ${anchorAfter?.top}px`,
    ).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);

    /**
     * ...and the consequence D7a needs: the loading head is pushed up out of
     * the proximity band, which is what lets the rising edge re-arm.
     *
     * Either it is still mounted and has moved UP, or the virtualizer has
     * unmounted it entirely — both are "left the band", and which one occurs
     * depends on the spliced height, so accepting only one would make this
     * flaky by construction.
     */
    const dividerYAfter = await divider(page)
      .boundingBox()
      .catch(() => null);
    if (dividerYAfter) {
      expect(dividerYAfter.y).toBeLessThan(dividerYBefore!.y);
    }

    /**
     * The walk CONTINUES. This is the property the alternative D7a rejected
     * (leave `scrollTop` alone + re-arm on a timer) could not deliver honestly,
     * and the one a partial implementation silently loses: if proximity never
     * lapsed, no second request is issuable.
     */
    const sentBefore = frames.sent.length;
    // `scrollDividerIntoDom` first, not `pinDividerToTop`: the anchor left the
    // view ~36000px below the divider, and the bounded 6-pass pin is built for
    // re-establishing a position that is already close. The polling climb is
    // the one that copes with the distance.
    await scrollDividerIntoDom(page);
    await pinDividerToTop(page);
    await settleClickTarget(page);
    await clickLoadEarlierWithoutScrolling(page);
    await awaitBackfillResults(page, frames, 2);
    expect(frames.sent.length, "a second slice was requestable").toBeGreaterThan(sentBefore);
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
    await openWindowedSession(page, session.sessionId);
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
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session.sessionId);
    await pinDividerToTop(page);
    await settleClickTarget(page);

    // Hold a real selection over a mounted transcript row, and capture where it
    // sits on screen.
    const selected = await page.evaluate(() => {
      const row = document.querySelector("[data-index] p, [data-index] div");
      if (!row || !row.textContent?.trim()) return null;
      const range = document.createRange();
      range.selectNodeContents(row);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return sel?.toString() ?? null;
    });
    expect(selected, "a selection was established").toBeTruthy();

    const rectBefore = await page.evaluate(() => {
      const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return r ? { top: r.top } : null;
    });
    expect(rectBefore).toBeTruthy();

    const el = scroller(page);
    const heightBefore = await el.evaluate((n) => n.scrollHeight);

    await clickLoadEarlierWithoutScrolling(page);
    await awaitBackfillResults(page, frames);
    // Same reason as F9: in `tail-only` the divider leaves the viewport, so the
    // convergence wait must be on `scrollTop`.
    expect(await settledScrollTop(page), "the anchor stopped correcting").not.toBeNull();
    await page.waitForTimeout(2_000);

    // Non-vacuity: content arrived above the selection.
    expect(await el.evaluate((n) => n.scrollHeight)).toBeGreaterThan(heightBefore + 1_000);

    // The selection still holds the same text...
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? null)).toBe(selected);

    // ...and the compensator held it in place. Without an ACTIVE compensator in
    // this mode the selected row is displaced by the full spliced height.
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
