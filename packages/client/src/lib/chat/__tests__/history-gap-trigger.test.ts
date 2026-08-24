/**
 * The scroll-proximity auto-load trigger — `shouldAutoLoadHistory`.
 *
 * This is the central new behaviour of the change, and it lives in a PURE
 * module for the same reason `captureScrollAnchor` was extracted: jsdom
 * reports no layout, so a predicate asserted inside a virtualized component
 * would be vacuous. The predicate receives booleans; `ChatView` owns the settle
 * timer, the suppression stamp, and the intent flag.
 *
 * The rule tracks INTENT, not position. Two weaker rules were rejected in
 * design and each has a scenario here: a scroll-DELTA rule stalls because
 * `scrollTop` clamps at 0, and a RISING-EDGE-of-proximity rule stalls one step
 * later when a splice smaller than the proximity band leaves the user in-band.
 *
 * See change: add-tail-only-replay-window (D7), test-plan F1-F4, F2a, F2b, F7.
 */
import { describe, expect, it } from "vitest";
import { SETTLE_MS, shouldAutoLoadHistory, type TriggerInputs } from "../history-gap.js";

/** A state that fires: head-free, in-band, intent expressed, motion settled. */
const firing = (over: Partial<TriggerInputs> = {}): TriggerInputs => ({
  headFree: true,
  nearTop: true,
  pendingUserIntent: true,
  suppressed: false,
  armed: true,
  pending: false,
  failed: false,
  unservable: false,
  atFloor: false,
  ...over,
});

describe("shouldAutoLoadHistory — the legal transition (F1)", () => {
  /**
   * #F1 — the whole conjunction satisfied. "Exactly once" is a property of the
   * CALLER clearing `pendingUserIntent` on issue, so it is asserted as such:
   * the predicate is true, and false again once the flag is cleared.
   */
  it("F1: fires when head-free, near the top, with intent, outside suppression", () => {
    expect(shouldAutoLoadHistory(firing())).toBe(true);
    // Clearing the flag on issue is what bounds it to one request per intent.
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: false }))).toBe(false);
  });
});

describe("shouldAutoLoadHistory — the illegal transitions (F2, F2a, F2b, F3, F4)", () => {
  /**
   * #F2 — the chain-load guard. After a request, the flag is cleared and every
   * scroll event the SPLICE itself provokes is stamped, so it sets nothing.
   * Covers both the splice-induced and the measurement-commit re-fire.
   */
  it("F2: nearTop alone, with no intent since the last request, does not fire", () => {
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: false }))).toBe(false);
    // ...and it stays false however many stamped events arrive.
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: false, suppressed: true }))).toBe(false);
  });

  /**
   * #F2a — the walk must not STALL. A splice smaller than the proximity band
   * leaves the user still `nearTop`, so a rising-edge rule would never produce
   * a new edge. One un-stamped user scroll re-sets the intent and it fires.
   */
  it("F2a: a small splice leaving the user in-band still fires on the next user scroll", () => {
    // Immediately after the splice: in-band, but the flag was cleared on issue.
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: false }))).toBe(false);
    // One further un-stamped scroll re-expresses intent — position never changed.
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: true }))).toBe(true);
  });

  /**
   * #F2b — a suppressed evaluation is DEFERRED, not consumed. It changes no
   * state, so the intent survives every intermediate measurement frame and the
   * post-expiry evaluation fires exactly once. This is what makes the
   * scroll-to-top landing deterministic regardless of how many frames it took.
   */
  it("F2b: evaluations inside the suppression window fire nothing and consume nothing", () => {
    const inWindow = firing({ suppressed: true });
    for (let i = 0; i < 3; i++) expect(shouldAutoLoadHistory(inWindow)).toBe(false);
    // The stamp lapses; the SAME inputs minus suppression now fire.
    expect(shouldAutoLoadHistory({ ...inWindow, suppressed: false })).toBe(true);
  });

  // #F3 — a two-sided gap is NEVER auto-loaded; click-to-load stays its only
  // affordance. Keyed on the announced shape, never on a sentinel.
  it("F3: an identical state in a head-tail window never fires", () => {
    expect(shouldAutoLoadHistory(firing({ headFree: false }))).toBe(false);
  });

  // #F4 — every disarm flag independently vetoes, including `armed`, which the
  // proposal's own summary elided.
  it.each([
    ["pending", { pending: true }],
    ["failed", { failed: true }],
    ["unservable", { unservable: true }],
    ["atFloor", { atFloor: true }],
    ["not armed", { armed: false }],
    ["not nearTop", { nearTop: false }],
  ])("F4: %s vetoes on its own", (_label, over) => {
    expect(shouldAutoLoadHistory(firing(over))).toBe(false);
  });
});

/**
 * #F7 — the momentum boundary `SETTLE_MS = 120` deliberately risks. Momentum
 * IS a stream of scroll events, each restarting the timer, so the predicate
 * runs exactly once when inertia stops. The timer is the caller's, so this
 * drives the caller's shape: record-and-restart on every event, evaluate only
 * at expiry.
 */
describe("the settle timer bounds evaluation to one per gesture (F7)", () => {
  /**
   * Minimal model of `ChatView`'s record-and-restart bookkeeping. A step is a
   * scroll EVENT followed by `silence` ms of quiet; the timer expires (and the
   * predicate is evaluated) only when that silence outlasts `SETTLE_MS`. A
   * trailing `null` step is pure silence with NO event — no new intent.
   */
  function runGesture(steps: Array<number | null>): number {
    let fires = 0;
    let pendingUserIntent = false;
    const evaluate = () => {
      if (shouldAutoLoadHistory(firing({ pendingUserIntent }))) {
        fires++;
        pendingUserIntent = false; // cleared on issue
      }
    };
    for (const silence of steps) {
      if (silence === null) {
        // Quiet with no scroll event: the timer expires, but nothing asked.
        evaluate();
        continue;
      }
      // A scroll event: record intent, restart the timer.
      pendingUserIntent = true;
      if (silence >= SETTLE_MS) evaluate();
    }
    return fires;
  }

  it("F7: no fire while events are 110ms apart; exactly one after 130ms of silence", () => {
    expect(SETTLE_MS).toBe(120);
    // Four events 110ms apart — every timer is restarted before it expires.
    expect(runGesture([110, 110, 110, 110])).toBe(0);
    // The same burst followed by 130ms of silence fires exactly once.
    expect(runGesture([110, 110, 110, 110, 130])).toBe(1);
    // Further quiet with NO new scroll event does not fire again: the flag was
    // cleared on issue, so the walk advances only on a fresh expression of intent.
    expect(runGesture([110, 110, 110, 110, 130, null, null])).toBe(1);
  });
});
