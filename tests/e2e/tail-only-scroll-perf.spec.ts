import { expect, test } from "./fixtures.js";
import {
  type MemoryLimits,
  WINDOW,
  type WindowedSession,
  buildWindowedSession,
  openWindowedSession,
  teardownWindowedSession,
  writeLimits,
} from "./helpers/windowed-session.js";

/**
 * OPT-IN scroll-smoothness probe for `add-tail-only-replay-window` (task 7.1,
 * test-plan #P2). Skipped unless `PW_PERF=1`.
 *
 * RUN: PW_PERF=1 npm run test:e2e -- tail-only-scroll-perf
 *
 * WHY OPT-IN / ADVISORY, not a blocking gate: this follows the precedent set by
 * `chat-render-perf.spec.ts` — absolute frame budgets inside a shared Docker
 * container are machine- and load-dependent, so they flake as CI gates. The
 * question #P2 actually asks is comparative ("no ADDITIONAL dropped frames vs
 * the `head-tail` baseline"), so this measures a RATIO between two arms rather
 * than an absolute number, and reports the figures for a human to read.
 *
 * WHAT IS MEASURED: a `requestAnimationFrame` loop samples inter-frame gaps
 * while the transcript is scrolled upward continuously for 5s. A gap over
 * `LONG_FRAME_MS` counts as dropped. Two arms, then a ratio.
 *
 * WHY ONE SESSION MEASURED TWICE: the arms must differ ONLY in replay shape.
 * Building two sessions would let transcript content drift between them (turn
 * count, tool-output size), and that difference would land in the measurement.
 * So the session is built once and `replayWindowMode` is flipped underneath it
 * — the same events, replayed two ways.
 *
 * DEVIATION FROM #P2 AS WRITTEN: the manifest said "20k-event session". One
 * `long-transcript` is ~604 events, and there is no session-file seeding path
 * in `tests/e2e/`, so 20k would mean ~33 sequential prompt rounds — tens of
 * minutes of building per run, and fragile. `TRANSCRIPTS` below buys a
 * multi-thousand-event stream whose gap is far larger than `BACKFILL_MAX_SPAN`,
 * which is what makes the tail-only walk observable at all. The manifest row
 * was amended to match what is actually built rather than leaving the plan
 * claiming a size no one runs.
 */

/** 3 transcripts ≈ 1.8k events — a gap several times `BACKFILL_MAX_SPAN` (500). */
const TRANSCRIPTS = 3;
/** ~2 missed vsyncs at 60Hz. Below this a frame is not meaningfully janky. */
const LONG_FRAME_MS = 32;
const SCROLL_MS = 5_000;
/**
 * Tail-only may drop up to 50 % more long frames than `head-tail` before this
 * complains. Generous on purpose: the arms run minutes apart in a shared
 * container, so run-to-run noise is real, and this probe exists to catch a
 * structural regression (a layout read or allocation added to the scroll hot
 * path), not a few percent of drift.
 */
const MAX_RATIO = 1.5;
/**
 * Long frames per 1000px travelled, used when the baseline arm drops none.
 *
 * Raw counts are not comparable across the arms: `head-tail` reaches the top of
 * a two-sided window quickly (~2.1k px measured) while `tail-only` keeps
 * loading and climbs ~11.6k px in the same 5s, so a raw-count comparison
 * penalises it for doing strictly more work. Measured 0.17/1000px on a clean
 * run against this ceiling.
 */
const MAX_LONG_FRAMES_PER_1000PX = 1.5;

interface ScrollSample {
  frames: number;
  longFrames: number;
  worstGapMs: number;
  /** Total px actually travelled. Zero means the loop measured an idle list. */
  distancePx: number;
  /** Rendered rows at the start / end — growth proves a splice landed mid-measurement. */
  rowsBefore: number;
  rowsAfter: number;
  /** Whether the climb reached the top, i.e. whether the trigger could fire at all. */
  reachedTop: boolean;
}

/**
 * Park at the BOTTOM so the climb has somewhere to go.
 *
 * `openWindowedSession` finishes by pinning the divider to the top, i.e. at
 * `scrollTop === 0`. Measuring from there produced `distancePx: 0` on both arms
 * — a flawless frame profile over a list that never moved. This is what makes
 * the subsequent measurement real.
 */
async function parkAtBottom(page: import("@playwright/test").Page): Promise<number> {
  const height = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="chat-scroll-container"]');
    if (!(list instanceof HTMLElement)) throw new Error("chat-scroll-container not found");
    list.scrollTop = list.scrollHeight;
    return list.scrollTop;
  });
  await page.waitForTimeout(1_000);
  return height;
}

/**
 * Scroll upward continuously for `SCROLL_MS`, sampling frame gaps throughout.
 *
 * The scroll is driven INSIDE the rAF loop rather than from Playwright: a
 * per-step `page.evaluate` would serialise a CDP round trip into every step and
 * measure the harness rather than the app.
 */
async function measureScrollUp(page: import("@playwright/test").Page): Promise<ScrollSample> {
  return page.evaluate(
    ({ scrollMs, longFrameMs }) => {
      const list = document.querySelector('[data-testid="chat-scroll-container"]');
      if (!(list instanceof HTMLElement)) {
        throw new Error("chat-scroll-container not found");
      }

      const rowCount = () => list.querySelectorAll("[data-index]").length;

      return new Promise<{
        frames: number;
        longFrames: number;
        worstGapMs: number;
        distancePx: number;
        rowsBefore: number;
        rowsAfter: number;
        reachedTop: boolean;
      }>((resolve) => {
        let frames = 0;
        let longFrames = 0;
        let worstGapMs = 0;
        let distancePx = 0;
        let reachedTop = false;
        const rowsBefore = rowCount();
        let last = performance.now();
        const started = last;

        const step = (now: number) => {
          const gap = now - last;
          last = now;
          frames += 1;
          if (gap > longFrameMs) longFrames += 1;
          if (gap > worstGapMs) worstGapMs = gap;

          /**
           * Climb steadily, recording the distance ACTUALLY travelled.
           *
           * Once the top is reached the writes become no-ops, so without this
           * the loop would keep sampling an idle list and report a flawless
           * frame profile that proves nothing. `distancePx` is what makes the
           * measurement falsifiable.
           */
          const before = list.scrollTop;
          list.scrollTop = Math.max(0, before - 40);
          distancePx += before - list.scrollTop;
          if (list.scrollTop === 0) reachedTop = true;

          if (now - started < scrollMs) {
            requestAnimationFrame(step);
          } else {
            resolve({
              frames,
              longFrames,
              worstGapMs,
              distancePx,
              rowsBefore,
              rowsAfter: rowCount(),
              reachedTop,
            });
          }
        };

        requestAnimationFrame(step);
      });
    },
    { scrollMs: SCROLL_MS, longFrameMs: LONG_FRAME_MS },
  );
}

test.describe("tail-only scroll smoothness (advisory, PW_PERF only)", () => {
  test.skip(!process.env.PW_PERF, "perf probe is opt-in: set PW_PERF=1");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(900_000);

  let session: WindowedSession | undefined;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(1_500_000);
    // Built in head-tail; the arms flip the mode underneath the same events.
    session = await buildWindowedSession(browser, { mode: "head-tail", transcripts: TRANSCRIPTS });
  });

  test.afterAll(async ({ browser }) => {
    if (session) await teardownWindowedSession(browser, session);
  });

  test("P2: tail-only scrolling drops no more frames than the head-tail baseline", async ({
    page,
  }, testInfo) => {
    const limits = (mode: string): MemoryLimits => ({
      maxReplayEvents: WINDOW,
      replayWindowMode: mode,
    });

    // --- baseline arm: head-tail ---
    await writeLimits(page, limits("head-tail"));
    await openWindowedSession(page, session!.sessionId);
    await page.waitForTimeout(1_000);
    const headTailStart = await parkAtBottom(page);
    const headTail = await measureScrollUp(page);

    // --- subject arm: tail-only, same session, same events ---
    await writeLimits(page, limits("tail-only"));
    await openWindowedSession(page, session!.sessionId);
    await page.waitForTimeout(1_000);
    const tailOnlyStart = await parkAtBottom(page);
    const tailOnly = await measureScrollUp(page);

    const per1000 = (s: ScrollSample) =>
      s.distancePx === 0 ? Number.POSITIVE_INFINITY : (s.longFrames / s.distancePx) * 1000;
    const report = {
      startScrollTop: { headTail: headTailStart, tailOnly: tailOnlyStart },
      headTail,
      tailOnly,
      longFramesPer1000px: { headTail: per1000(headTail), tailOnly: per1000(tailOnly) },
      longFrameRatio: headTail.longFrames === 0 ? null : tailOnly.longFrames / headTail.longFrames,
    };
    await testInfo.attach("scroll-frame-report.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    console.log("[P2] scroll frame report:", JSON.stringify(report));

    /**
     * Non-vacuity, three ways. A perf gate that has never once failed is
     * usually measuring nothing, and the first draft of this one reported an
     * identical flawless profile on BOTH arms — the signature of a loop
     * sampling an idle list after the climb had already bottomed out.
     */
    expect(headTail.frames, "the baseline arm produced no frames").toBeGreaterThan(60);
    expect(tailOnly.frames, "the tail-only arm produced no frames").toBeGreaterThan(60);
    expect(headTail.distancePx, "the baseline arm never actually scrolled").toBeGreaterThan(500);
    expect(tailOnly.distancePx, "the tail-only arm never actually scrolled").toBeGreaterThan(500);
    /**
     * The tail-only arm must reach the top, since that is the only place the
     * auto-load trigger can fire — a run that never got there would compare
     * two plain scrolls and say nothing about the walk this change added.
     */
    expect(tailOnly.reachedTop, "tail-only never reached the top, so no load could fire").toBe(true);
    /**
     * The strongest non-vacuity guarantee: rendered rows GREW during the
     * measurement, so a backfill splice actually landed inside the sampled
     * window. Without this the probe could climb a static transcript and still
     * report a perfect frame profile, saying nothing about the auto-load walk.
     * Measured 13 -> 21 rows on a clean run.
     */
    expect(
      tailOnly.rowsAfter,
      `no splice landed during the measurement (rows ${tailOnly.rowsBefore} -> ${tailOnly.rowsAfter})`,
    ).toBeGreaterThan(tailOnly.rowsBefore);

    /**
     * Compared as a ratio only when the baseline actually dropped frames. With
     * a clean baseline (`longFrames === 0`) a ratio is undefined, so the
     * subject is held to a DISTANCE-NORMALISED rate instead — a raw count would
     * punish `tail-only` for travelling ~5x further in the same window.
     */
    if (headTail.longFrames === 0) {
      expect(
        per1000(tailOnly),
        `head-tail dropped none; tail-only dropped ${tailOnly.longFrames} over ` +
          `${Math.round(tailOnly.distancePx)}px`,
      ).toBeLessThanOrEqual(MAX_LONG_FRAMES_PER_1000PX);
    } else {
      expect(
        tailOnly.longFrames / headTail.longFrames,
        `tail-only ${tailOnly.longFrames} vs head-tail ${headTail.longFrames} long frames`,
      ).toBeLessThanOrEqual(MAX_RATIO);
    }
  });
});
