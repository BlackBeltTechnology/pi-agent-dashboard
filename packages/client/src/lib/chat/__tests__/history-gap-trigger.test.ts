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

/**
 * #P1 — the trigger's per-scroll-event cost.
 *
 * `handleScroll` runs on EVERY scroll event, at up to 60Hz during a fling, on
 * a thread that is also driving a virtualized transcript. D7's bookkeeping adds
 * three things to that path: a `Date.now()` comparison, a boolean write, and a
 * `clearTimeout`/`setTimeout` pair. The budget exists because a regression here
 * would not announce itself as a bug — it would show up as scroll jank, which
 * is exactly what issue #521 was already about.
 *
 * Measured against a NO-OP baseline rather than in absolute terms: absolute
 * millisecond thresholds are machine-dependent and flake on loaded CI. The
 * comparison is the assertion, and the budget is deliberately generous — this
 * pins an order of magnitude, not a microbenchmark.
 */
describe("P1: the per-event bookkeeping cost stays negligible", () => {
  /** 5s at 60Hz, the design's stated scenario. */
  const EVENTS = 300;

  /** Model of `handleScroll`'s trigger half — the code the budget is about. */
  function bookkeeping(state: {
    programmaticUntil: number;
    intent: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  }): void {
    if (Date.now() >= state.programmaticUntil) state.intent = true;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {}, SETTLE_MS);
  }

  function timed(fn: () => void, iterations: number): number {
    // One warm-up pass so JIT compilation is not attributed to the measurement.
    for (let i = 0; i < iterations; i++) fn();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    return performance.now() - start;
  }

  it("P1: adds well under 1ms per event, and stays close to a no-op baseline", () => {
    const state = { programmaticUntil: 0, intent: false, timer: null as ReturnType<typeof setTimeout> | null };
    let sink = 0;

    const baseline = timed(() => {
      sink += 1;
    }, EVENTS);
    const measured = timed(() => bookkeeping(state), EVENTS);
    if (state.timer) clearTimeout(state.timer);
    expect(sink).toBeGreaterThan(0);

    const perEvent = measured / EVENTS;
    // The headline budget from the test plan.
    expect(perEvent, `${perEvent.toFixed(4)}ms per event`).toBeLessThan(1);

    /**
     * And an order-of-magnitude ceiling over the no-op, which is what actually
     * catches a regression: someone adding a layout read (`scrollHeight`,
     * `getBoundingClientRect`) to this path would blow past it while still
     * measuring under 1ms on a fast machine.
     *
     * `+1ms` absorbs timer-resolution noise on a near-zero baseline; without it
     * the ratio is dominated by measurement granularity rather than by work.
     *
     * FALSIFIABILITY, measured rather than assumed — a perf assertion that
     * cannot fail is worse than none, because it reports a budget it does not
     * enforce. Injecting a busy loop into `bookkeeping`:
     *   • 20,000 iterations/event  → still PASSES (both assertions)
     *   • 200,000 iterations/event → FAILS here, 17.5ms vs a 2.59ms budget
     * So this gate catches an ORDER-OF-MAGNITUDE regression, not a 10%
     * one. That is the intended resolution: the per-event budget is ~1000x
     * larger than the real cost, so anything tighter would flake on loaded CI.
     */
    expect(measured).toBeLessThan(baseline * 50 + 1);
  });

  /**
   * The predicate itself is called ONCE per gesture, not per event — but it is
   * pure and trivially cheap, and pinning that keeps a future refactor from
   * quietly moving real work (a DOM read, an allocation) inside it.
   */
  it("P1: the predicate is cheap enough to be called per event even though it is not", () => {
    const t = firing();
    const elapsed = timed(() => {
      shouldAutoLoadHistory(t);
    }, EVENTS);
    expect(elapsed / EVENTS, `${(elapsed / EVENTS).toFixed(6)}ms per call`).toBeLessThan(0.1);
  });
});

/**
 * Intent must not go STALE — the defect an audit of D7 surfaced.
 *
 * `handleScroll` records intent on ANY scroll event outside the stamp window,
 * regardless of direction, and nothing clears it except an issue, a mount, or a
 * session change. `scrollToBottom` scrolls with `behavior: "smooth"`, which
 * emits scroll events for 300-500ms while the stamp covers only `SETTLE_MS`
 * (120) — so a DOWNWARD smooth scroll latches "the user asked to go up", and a
 * later programmatic jump that lands `nearTop` reads that stale flag and
 * fetches something nobody asked for.
 *
 * The fix makes `stampProgrammaticScroll()` CLEAR intent: a programmatic
 * reposition invalidates any intent recorded before it. That imposes an
 * ordering contract on callers that ARE intent (`scrollToTop`): stamp first,
 * then set the flag. Both halves are modelled below, because getting the order
 * backwards silently disables the feature rather than breaking a type.
 */
describe("intent does not survive a programmatic reposition", () => {
  /** Model of the ChatView refs the stamp and the scroll handler share. */
  function makeRefs() {
    const refs = { until: 0, intent: false };
    return {
      refs,
      /** `stampProgrammaticScroll` — stamps AND invalidates prior intent. */
      stamp(now: number) {
        refs.until = now + SETTLE_MS;
        refs.intent = false;
      },
      /** `handleScroll`'s trigger half. */
      onScroll(now: number) {
        if (now >= refs.until) refs.intent = true;
      },
    };
  }

  /**
   * The reported scenario. A smooth descent outlives the stamp, so its later
   * scroll events legitimately record intent; the NEXT programmatic writer must
   * then clear it, or that writer's own landing fires a request.
   */
  it("a smooth scroll-to-bottom cannot leave intent latched for a later jump", () => {
    const { refs, stamp, onScroll } = makeRefs();

    // t=0 scrollToBottom stamps; smooth scrolling emits events past the stamp.
    stamp(0);
    onScroll(50); // inside the window — correctly ignored
    expect(refs.intent).toBe(false);
    onScroll(400); // smooth scroll STILL emitting, now outside the window
    expect(refs.intent, "a late smooth-scroll event records intent").toBe(true);

    // t=1000 an unrelated programmatic jump (scrollToTurn / restore) lands near
    // the top. It stamps, which must invalidate the stale intent above.
    stamp(1000);
    expect(
      shouldAutoLoadHistory(firing({ pendingUserIntent: refs.intent })),
      "a programmatic jump fired on intent recorded by an earlier descent",
    ).toBe(false);
  });

  // The other half of the contract: an activation that IS intent must survive.
  it("scroll-to-top's own intent survives, because it stamps BEFORE setting it", () => {
    const { refs, stamp } = makeRefs();
    stamp(0); // scrollToTop stamps first...
    refs.intent = true; // ...then records intent
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: refs.intent }))).toBe(true);
  });

  // And the inverted order is exactly the silent-disable this pins against.
  it("the reversed order would silently disable scroll-to-top", () => {
    const { refs, stamp } = makeRefs();
    refs.intent = true; // intent first...
    stamp(0); // ...then the stamp wipes it
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: refs.intent }))).toBe(false);
  });
});

/**
 * The splice-anchor CORRECTION must not eat intent.
 *
 * Caught by the E2E non-vacuity row, not by review: making every stamp
 * invalidate intent fixed the stale-intent jump but broke the walk, because
 * the D7a anchor stamps on ~20 consecutive frames after every splice. Any
 * scroll the user starts in that ~333ms window had its intent wiped, so the
 * next evaluation saw nothing and the walk stalled until they scrolled again.
 *
 * A correction PRESERVES position; only a JUMP relocates. See change:
 * add-tail-only-replay-window (D7, D7a).
 */
describe("a splice correction suppresses its own events without eating intent", () => {
  function makeRefs() {
    const refs = { until: 0, intent: false };
    return {
      refs,
      stamp(now: number, invalidateIntent = true) {
        refs.until = now + SETTLE_MS;
        if (invalidateIntent) refs.intent = false;
      },
      onScroll(now: number) {
        if (now >= refs.until) refs.intent = true;
      },
    };
  }

  it("intent recorded during the correction window survives to the evaluation", () => {
    const { refs, stamp, onScroll } = makeRefs();

    // The user scrolls up; intent is recorded.
    onScroll(0);
    expect(refs.intent).toBe(true);

    // A splice lands and the anchor corrects across 20 frames (~16ms apart).
    for (let f = 0; f < 20; f++) stamp(f * 16, false);

    expect(
      shouldAutoLoadHistory(firing({ pendingUserIntent: refs.intent })),
      "the correction loop wiped a gesture the user actually made",
    ).toBe(true);
  });

  // The contrast: a JUMP in the same position still invalidates.
  it("a jump still invalidates intent recorded before it", () => {
    const { refs, stamp, onScroll } = makeRefs();
    onScroll(0);
    expect(refs.intent).toBe(true);
    stamp(100); // a relocation
    expect(shouldAutoLoadHistory(firing({ pendingUserIntent: refs.intent }))).toBe(false);
  });
});
