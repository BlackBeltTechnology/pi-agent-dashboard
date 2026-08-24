import { expect, test } from "./fixtures.js";
import {
  buildWindowedSession,
  divider,
  nudgeAscent,
  openWindowedSession,
  scroller,
  teardownWindowedSession,
  type WindowedSession,
  watchBackfillFrames,
} from "./helpers/windowed-session.js";

/**
 * L3 gate for D7's SUPPRESSION model — test-plan rows F5, F6, F8, F19, F20
 * (change: add-tail-only-replay-window).
 *
 * ── Why these rows cannot live at L1 ────────────────────────────────────────
 * D7 deliberately extracted `shouldAutoLoadHistory` as a pure predicate so its
 * decision table could be pinned in jsdom, precisely BECAUSE jsdom reports no
 * layout. That split leaves a matching obligation here: the predicate's inputs
 * are only correct if every programmatic `scrollTop` writer stamps the
 * suppression window before it writes. `ChatView` has nine such writers, and a
 * missing stamp is invisible to the predicate's own tests — the predicate is
 * handed `suppressed: false` and answers correctly. Only a real scroller,
 * moved by the real product code, can show the stamp missing.
 *
 * So this file asserts the NEGATIVE case almost exclusively: a programmatic
 * movement into the proximity band must produce ZERO `history_backfill` frames.
 * That is the assertion that goes red when a writer is added without a stamp,
 * which is the specific hazard D7 names ("enumerating the writers is how the
 * previous revision failed").
 *
 * ── Non-vacuity ─────────────────────────────────────────────────────────────
 * A spec that proves "no request happened" is worthless if a request could
 * never have happened. Every negative row here is therefore paired with a
 * positive control on the SAME session and the SAME frame watcher: after
 * asserting silence, a genuine user ascent (`nudgeAscent`) must produce a
 * frame. Without that pairing a broken session, a mis-built window, or a
 * divider that never mounted would all pass as "suppressed".
 *
 * ── Why frames, not UI ──────────────────────────────────────────────────────
 * The observable is the `history_backfill` frame on the wire, read through
 * `watchBackfillFrames`. The divider's rendered state cannot distinguish "no
 * request was issued" from "a request was issued and resolved instantly", and
 * it is the ISSUE that D7 governs.
 *
 * See change: add-tail-only-replay-window (D7).
 */

/**
 * Long enough to outlast `SETTLE_MS` (120) plus the settle timer's own
 * evaluation, the WebSocket round trip, and a splice. A shorter wait would let
 * a genuinely-broken build pass by simply being slow.
 */
const QUIET_MS = 3_000;

// Serial: every row shares one built session and mutates its scroll position.
test.describe.configure({ mode: "serial" });

let session: WindowedSession | undefined;

test.describe("tail-only trigger suppression", () => {
  test.setTimeout(300_000);

  test.beforeAll(async ({ browser }) => {
    // `test.setTimeout` at describe scope does NOT reach hooks — they keep the
    // default 60s, which three `long-transcript` builds blow through long
    // before they finish. Set it INSIDE the hook.
    test.setTimeout(1_500_000);
    // Three transcripts so the gap outlasts several slices: each positive
    // control below consumes one.
    session = await buildWindowedSession(browser, { mode: "tail-only", transcripts: 3 });
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    // Guarded: `afterAll` still runs when `beforeAll` failed, and an unguarded
    // teardown would mask that failure with a second, confusing one.
    if (session) await teardownWindowedSession(browser, session);
  });

  /**
   * #F5 — session restore.
   *
   * A session saved scrolled to the top is restored by writing `scrollTop`
   * during a layout effect on first paint. That lands the view in the
   * proximity band having recorded no user intent whatsoever, so a
   * position-keyed rule fires a request the user never asked for. D7 kills
   * this twice over: the restore writers stamp, and `pendingUserIntent` is
   * cleared on session change.
   */
  test("F5: restoring a session saved at the top issues no request", async ({ page }) => {
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session!.sessionId);

    // Park at the top, then leave. `handleScroll` persists this position.
    await scroller(page).evaluate((n) => {
      n.scrollTop = 0;
    });
    await page.waitForTimeout(500);
    const beforeSwitch = frames.sent.length;

    // Switch away and back — the restore path writes scrollTop on first paint.
    await page.getByTestId("back-button").click().catch(() => undefined);
    await page.waitForTimeout(500);
    await openWindowedSession(page, session!.sessionId);
    await page.waitForTimeout(QUIET_MS);

    expect(
      frames.sent.length,
      "restore drove scrollTop into the proximity band and the trigger fired",
    ).toBe(beforeSwitch);

    // Positive control: the same session, the same watcher, a real ascent.
    await nudgeAscent(page);
    await expect
      .poll(() => frames.sent.length, { timeout: 30_000 })
      .toBeGreaterThan(beforeSwitch);
  });

  /**
   * #F6 — scroll-to-top activation.
   *
   * The one place the user's intent and a programmatic scroll COINCIDE. The
   * ascent's own scroll events are stamped, so the intent flag set by the
   * activation is what the post-ascent evaluation reads. "Exactly one" is the
   * assertion: zero means the stamp swallowed the intent too, and more than one
   * means the splice chain-loaded.
   */
  test("F6: scroll-to-top activation issues exactly one request", async ({ page }) => {
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session!.sessionId);

    // Start from the bottom so the activation is a genuine long ascent.
    await scroller(page).evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    await page.waitForTimeout(500);
    const before = frames.sent.length;

    await page.getByTestId("scroll-to-top").click({ timeout: 30_000 });

    await expect.poll(() => frames.sent.length, { timeout: 30_000 }).toBe(before + 1);
    // Hold: the splice must not chain-load a second request on its own.
    await page.waitForTimeout(QUIET_MS);
    expect(frames.sent.length, "the splice chain-loaded").toBe(before + 1);
  });

  /**
   * #F8 — touch momentum.
   *
   * The reason `SETTLE_MS` exists rather than a `touchend` latch: WebKit fires
   * `touchend` BEFORE inertial scrolling begins, so clearing a latch there
   * re-enables the trigger during exactly the momentum phase that must be
   * deferred. Momentum IS a stream of scroll events, each restarting the timer,
   * so a correct build evaluates once — when inertia stops.
   */
  test("F8: a touch fling issues nothing until momentum stops, then exactly one", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session!.sessionId);

    await scroller(page).evaluate((n) => {
      n.scrollTop = 900;
    });
    await page.waitForTimeout(500);
    const before = frames.sent.length;

    /**
     * Synthesise the fling as a burst of scroll events ~40ms apart, each
     * restarting the settle timer, ending inside the proximity band. `touchend`
     * is dispatched EARLY — while the burst continues — which is what makes
     * this the WebKit-ordering scenario rather than a plain scroll.
     */
    await scroller(page).evaluate(async (n) => {
      n.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
      for (let y = 900; y >= 0; y -= 100) {
        n.scrollTop = y;
        await new Promise((r) => setTimeout(r, 40));
      }
    });

    // Mid-flight: the timer has been restarted on every step, so nothing yet.
    expect(frames.sent.length, "fired during momentum").toBe(before);

    await expect.poll(() => frames.sent.length, { timeout: 30_000 }).toBe(before + 1);
    await page.waitForTimeout(QUIET_MS);
    expect(frames.sent.length, "momentum produced a second request").toBe(before + 1);
  });

  /**
   * #F19 — `scrollToTurn`, and why it is NOT asserted here.
   *
   * The design names `scrollToTurn` as an unlatched ascent source, so the
   * intended row drove the butterfly-chart turn bar and asserted silence. That
   * row cannot be written honestly, and the reason is a PRODUCT property this
   * change surfaces rather than a harness limitation:
   *
   * `turnIndex` is assigned in the reducer (`event-reducer.ts`, the `turnUsage`
   * arm) to the LAST USER MESSAGE, and only if it does not already carry one.
   * A `tail-only` replay reduces only the tail, so the user messages that
   * anchor the earlier turns are in the GAP and are never reduced. Every
   * `TurnStat` therefore lands with `turnIndex: -1`, and `TokenStatsBar` gives
   * the `turn-bar` testid, the pointer cursor and the click handler ONLY to
   * bars with `turnIndex >= 0`.
   *
   * Measured on a real harness session: `stats-panel` 1, `butterfly-chart` 1,
   * 21 rendered bars, `turn-bar` 0. So in `tail-only` the control does not
   * exist to be clicked, and `scrollToTurn` is unreachable through the UI.
   *
   * Driving the imperative handle directly through a test-only `window` hook
   * would assert the stamp against a path no user can take, which is worse
   * than not asserting it: it would report coverage this change does not have.
   * The stamp on that writer stays as defensive code.
   *
   * This test PINS THE ASSUMPTION instead. If turn indices ever do survive a
   * windowed replay, this goes red and F19 becomes writable as specified.
   */
  test("F19 (assumption): tail-only leaves turn bars unindexed, so scrollToTurn is unreachable", async ({
    page,
  }) => {
    await openWindowedSession(page, session!.sessionId);
    const present = await page.evaluate(() => ({
      butterfly: document.querySelectorAll('[data-testid="butterfly-chart"]').length,
      bars: document.querySelector('[data-testid="butterfly-chart"]')?.children.length ?? -1,
      clickable: document.querySelectorAll('[data-testid="turn-bar"]').length,
    }));

    // Non-vacuity: the chart must actually be rendering bars, or "none are
    // clickable" is trivially true and pins nothing.
    expect(present.butterfly, "no butterfly chart rendered").toBe(1);
    expect(present.bars, "chart rendered no bars").toBeGreaterThan(0);
    expect(
      present.clickable,
      "turn bars became clickable in tail-only — F19 is now writable as specified",
    ).toBe(0);
  });

  /**
   * #F20 — the streaming bottom-pin and the selection compensator.
   *
   * Both write `scrollTop` on a cadence the user never triggers. On a SHORT
   * transcript the pinned bottom can itself sit inside the proximity band, so
   * an unstamped pin issues a request on every streamed chunk — a request
   * storm, not a single stray fetch.
   */
  test("F20: the bottom-pin and selection compensator issue nothing while streaming", async ({
    page,
  }) => {
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session!.sessionId);

    // Pin to the bottom and hold a selection, so BOTH writers are live.
    await scroller(page).evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    await page.waitForTimeout(500);
    const before = frames.sent.length;

    await page.evaluate(() => {
      const row = document.querySelector("[data-row-key]");
      if (!row) return;
      const range = document.createRange();
      range.selectNodeContents(row);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    // Stream real content, which drives the pin repeatedly.
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.fill("[[faux:long-transcript]] go");
    await page.getByTestId("send-button").click();
    await page.waitForTimeout(QUIET_MS * 2);

    expect(
      frames.sent.length,
      "a programmatic scrollTop writer fired the trigger while streaming",
    ).toBe(before);
  });

  /**
   * The suppression window must not be permanent. A stamp that never lapses
   * would make every row above pass while disabling the feature outright —
   * the one failure mode the negative rows cannot distinguish on their own.
   */
  test("the divider remains present and the walk still advances after suppression", async ({
    page,
  }) => {
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session!.sessionId);
    await expect(divider(page)).toBeVisible({ timeout: 60_000 });

    const before = frames.sent.length;
    await nudgeAscent(page);
    await expect.poll(() => frames.sent.length, { timeout: 30_000 }).toBeGreaterThan(before);
  });
});
