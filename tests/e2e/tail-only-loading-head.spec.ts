import { expect, test } from "./fixtures.js";
import {
  buildWindowedSession,
  clickLoadEarlierWithoutScrolling,
  divider,
  nudgeAscent,
  openWindowedSession,
  teardownWindowedSession,
  type WindowedSession,
  watchBackfillFrames,
} from "./helpers/windowed-session.js";

/**
 * L3 gate for the loading head's TERMINAL states — test-plan rows F11, F12,
 * F13, F16, F21 (change: add-tail-only-replay-window, D6).
 *
 * ── The row this file exists for ────────────────────────────────────────────
 * D6's asymmetry: a two-sided gap is SPLICED OUT when it drains, because the
 * head above it already explains where the transcript begins. A head-free gap
 * must RESOLVE TO A TERMINUS instead — removing it would leave a transcript
 * that silently starts mid-conversation, which is the exact
 * indistinguishable-from-data-loss failure the divider exists to prevent.
 *
 * F11 and F12 are therefore written as a PAIR against the same assertion, one
 * per mode. A regression that collapses the two branches into one turns
 * whichever mode it collapsed away red, which is the property that makes the
 * pair worth more than either row alone.
 *
 * ── Announcement scope ──────────────────────────────────────────────────────
 * F16/F21 are also a pair. The live-region announcement is scoped to AUTOMATIC
 * loads in `tail-only`: a user who pressed "Load earlier" already knows what
 * they asked for, and a `head-tail` user who never opted into this change must
 * observe nothing new. Asserting only F16 would let an over-broad
 * implementation pass.
 *
 * See change: add-tail-only-replay-window (D6).
 */

test.describe.configure({ mode: "serial" });

/** Enough silence to outlast SETTLE_MS, the round trip and a splice. */
const QUIET_MS = 3_000;

/**
 * Drain the head-free gap by repeatedly ascending, until the walk reports it
 * has nothing left. Bounded: an unbounded loop on a broken build would hang
 * until the suite timeout with no usable verdict.
 */
async function drainGap(page: import("@playwright/test").Page, maxRounds = 40): Promise<boolean> {
  for (let i = 0; i < maxRounds; i++) {
    const terminal = await page
      .getByTestId("history-gap-session-start")
      .or(page.getByTestId("history-gap-not-retained"))
      .count();
    if (terminal > 0) return true;
    await nudgeAscent(page);
    await page.waitForTimeout(500);
  }
  return (
    (await page
      .getByTestId("history-gap-session-start")
      .or(page.getByTestId("history-gap-not-retained"))
      .count()) > 0
  );
}

test.describe("tail-only loading head", () => {
  test.setTimeout(600_000);

  let session: WindowedSession | undefined;

  test.beforeAll(async ({ browser }) => {
    // Hooks do NOT inherit the describe-scope timeout.
    test.setTimeout(1_500_000);
    // ONE transcript: this file wants the gap to DRAIN, and each extra
    // transcript adds ~604 events, i.e. roughly one more full slice to walk.
    session = await buildWindowedSession(browser, { mode: "tail-only", transcripts: 1 });
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    if (session) await teardownWindowedSession(browser, session);
  });

  /**
   * #F11 — the head-free terminus.
   *
   * The divider must still be present after the walk drains, and it must read
   * as a terminus rather than as the error state. `unservable` ("no longer
   * available to load") would misreport a completed walk as a fault.
   */
  test("F11: a drained head-free gap resolves to a terminus and is NOT removed", async ({
    page,
  }) => {
    await openWindowedSession(page, session!.sessionId);
    await expect(divider(page)).toBeVisible({ timeout: 60_000 });

    const drained = await drainGap(page);
    expect(drained, "the head-free gap never reached a terminus").toBe(true);

    // The row SURVIVES — this is the whole asymmetry.
    await expect(divider(page)).toBeVisible();
    // ...and it is not the error/unservable state.
    await expect(page.getByTestId("history-gap-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("history-gap-error")).toHaveCount(0);

    /**
     * #F13 — and it does not falsely claim the earliest message was reached.
     * Which terminus is correct depends on the store floor: `oldestGapSeq === 1`
     * is the session's genuine beginning, above 1 means earlier events are not
     * retained. Exactly one of the two must be showing, and the wording must
     * name neither retention mechanism nor compaction.
     */
    const atStart = await page.getByTestId("history-gap-session-start").count();
    const notRetained = await page.getByTestId("history-gap-not-retained").count();
    expect(atStart + notRetained, "exactly one terminus row must show").toBe(1);
    await expect(divider(page)).not.toContainText(/compact|retention polic|trimmed/i);
  });

  /*
   * #X7 (a refused automatic request) is NOT asserted here.
   *
   * The refusal has to be REAL to be worth an L3 row, and the harness cannot
   * provoke one: the obvious lever is the server's `in_flight` guard, but the
   * trigger's own chain-load guard serialises requests, so two ascents in quick
   * succession never put a second `history_backfill` on the wire while the
   * first is out. Attempted directly — the race did not land, and the row
   * skipped rather than passed. That the race is unwinnable is evidence D7's
   * guard works, not a gap in it.
   *
   * The scenario's content is asserted at L1, where a refusal is constructible
   * directly: `useMessageHandler.history-gap.test.tsx` feeds a real
   * `history_backfill_result` carrying an error and pins that the gap goes
   * `failed` and that the trigger stays vetoed;
   * `HistoryGapDivider.test.tsx` pins that every protocol code collapses to one
   * sentence plus a retry, with no code reaching the user.
   * See change: add-tail-only-replay-window (test-plan X7).
   */

  /**
   * #F16 — the announcement.
   *
   * Content inserted ABOVE the reading position with no gesture of the user's
   * own needs announcing. POLITE, never assertive: the insertion is not urgent
   * and must not interrupt reading. Focus must not move across the splice.
   */
  test("F16: an automatic load announces politely and does not move focus", async ({ page }) => {
    // BEFORE the session opens: `watchBackfillFrames` subscribes to
    // `page.on("websocket")`, which only fires for sockets created AFTER the
    // listener is attached. Registering it later silently observes nothing and
    // the row fails as though no request were ever issued.
    const frames = watchBackfillFrames(page);
    await openWindowedSession(page, session!.sessionId);
    const region = page.getByTestId("history-gap-live-region");
    await expect(region).toHaveAttribute("aria-live", "polite");
    // Never assertive — that would interrupt a screen reader mid-sentence.
    await expect(region).not.toHaveAttribute("aria-live", "assertive");

    const focusBefore = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "",
    );

    const before = frames.sent.length;
    await nudgeAscent(page);
    await expect.poll(() => frames.sent.length, { timeout: 30_000 }).toBeGreaterThan(before);
    await page.waitForTimeout(QUIET_MS);

    await expect(region).toContainText(/\d[\d,]* earlier messages loaded/);

    const focusAfter = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "",
    );
    expect(focusAfter, "the splice moved document focus").toBe(focusBefore);
  });
});

/**
 * The `head-tail` half of both pairs. A separate session, because the mode is
 * server config and cannot differ per-test within one build.
 */
test.describe("head-tail contrast", () => {
  test.setTimeout(600_000);

  let session: WindowedSession | undefined;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(1_500_000);
    session = await buildWindowedSession(browser, { mode: "head-tail", transcripts: 1 });
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    if (session) await teardownWindowedSession(browser, session);
  });

  /**
   * #F12 — the two-sided gap is REMOVED when it drains. The head above it
   * already explains where the transcript begins, so a residual row would be
   * an interstitial disclosing nothing.
   *
   * #F21 rides along on the same drain: the explicit affordance must produce
   * NO announcement, so a `head-tail` user observes nothing new.
   */
  test("F12/F21: a drained two-sided gap is removed, and announces nothing", async ({ page }) => {
    await openWindowedSession(page, session!.sessionId, { requireLoadButton: true });
    await expect(divider(page)).toBeVisible({ timeout: 60_000 });

    // Drain through the EXPLICIT affordance — click-to-load is `head-tail`'s
    // only trigger, and F21 is specifically about that path.
    for (let i = 0; i < 40; i++) {
      if ((await divider(page).count()) === 0) break;
      const btn = page.getByTestId("history-gap-load");
      if ((await btn.count()) === 0) break;
      await clickLoadEarlierWithoutScrolling(page);
      await page.waitForTimeout(800);

      // F21: no announcement from a user-initiated load, at any point.
      const region = page.getByTestId("history-gap-live-region");
      if ((await region.count()) > 0) {
        await expect(region).not.toContainText(/earlier messages loaded/);
      }
    }

    // The interstitial is GONE — not converted to a terminus.
    await expect(divider(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("history-gap-session-start")).toHaveCount(0);
    await expect(page.getByTestId("history-gap-not-retained")).toHaveCount(0);
  });
});
