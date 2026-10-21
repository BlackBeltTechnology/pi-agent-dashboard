/**
 * `ArrivalTracker` — the arrival-detection module of chat motion (task 2.1).
 * Covers seeding, the A→B→A return, replay, the bulk guard, filter toggling,
 * re-parenting, steering consume/re-add, off-screen arrival, a replay-unaware
 * host and StrictMode double-render stability.
 * See change: add-fluid-chat-motion (D2).
 */
import { describe, expect, it } from "vitest";
import {
  type ArrivalInput,
  type ArrivalToolRow,
  ArrivalTracker,
  BULK_ARRIVAL_LIMIT,
  NO_ARRIVALS,
} from "../live-arrival.js";

const rows = (...specs: Array<string | [string, boolean]>): ArrivalToolRow[] =>
  specs.map((s) => (typeof s === "string" ? { id: s, running: false } : { id: s[0], running: s[1] }));

function input(over: Partial<ArrivalInput> = {}): ArrivalInput {
  return {
    sessionId: "A",
    toolRows: [],
    hasPendingPrompt: false,
    hasTail: false,
    hasThinking: false,
    steering: [],
    motionActive: true,
    replayAware: true,
    following: true,
    selecting: false,
    replayInFlight: false,
    loadingHistory: false,
    ...over,
  };
}

/** Render-then-commit, as ChatView does for every commit. */
function step(tracker: ArrivalTracker, i: ArrivalInput) {
  const decision = tracker.decide(i);
  tracker.commit(i);
  return decision;
}

describe("ArrivalTracker", () => {
  it("seeds on the first commit: nothing enters, every id is recorded (E7)", () => {
    const t = new ArrivalTracker();
    const thirty = rows(...Array.from({ length: 30 }, (_, i) => `t${i}`));
    const d = step(t, input({ toolRows: thirty }));
    expect(d).toBe(NO_ARRIVALS);
    expect(thirty.every((r) => t.hasSeen(r.id))).toBe(true);
    // A genuinely new id afterwards enters.
    const d2 = step(t, input({ toolRows: [...thirty, ...rows(["new", true])] }));
    expect([...d2.enteringToolIds]).toEqual(["new"]);
  });

  it("re-seeds on a session switch, so the A→B→A return animates nothing (E8)", () => {
    const t = new ArrivalTracker();
    step(t, input({ sessionId: "A", toolRows: rows("a1") }));
    step(t, input({ sessionId: "B", toolRows: rows("b1") }));
    // Three tools arrived for A while B was shown; switching back re-seeds.
    const back = step(t, input({ sessionId: "A", toolRows: rows("a1", "a2", "a3", "a4") }));
    expect(back.enteringToolIds.size).toBe(0);
    expect(t.hasSeen("a4")).toBe(true);
    // The next live arrival in A does animate.
    expect([...step(t, input({ sessionId: "A", toolRows: rows("a1", "a2", "a3", "a4", ["a5", true]) })).enteringToolIds]).toEqual(["a5"]);
  });

  it("treats a replay-in-flight or history-loading commit as non-live", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("x") }));
    const replay = step(t, input({ toolRows: rows("x", "y"), replayInFlight: true }));
    expect(replay.enteringToolIds.size).toBe(0);
    expect(replay.cueAllowed).toBe(false);
    const loading = step(t, input({ toolRows: rows("x", "y", "z"), loadingHistory: true }));
    expect(loading.enteringToolIds.size).toBe(0);
    // Both were recorded: they never animate later.
    expect(t.hasSeen("y") && t.hasSeen("z")).toBe(true);
  });

  it("bulk guard: 4 new ids enter, 5 do not (E9)", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("seed") }));
    const four = step(t, input({ toolRows: rows("seed", "a", "b", "c", "d") }));
    expect(four.enteringToolIds.size).toBe(BULK_ARRIVAL_LIMIT);
    const t2 = new ArrivalTracker();
    step(t2, input({ toolRows: rows("seed") }));
    const five = step(t2, input({ toolRows: rows("seed", "a", "b", "c", "d", "e") }));
    expect(five.enteringToolIds.size).toBe(0);
    expect(five.cueAllowed).toBe(false);
  });

  it("status flips count toward the bulk limit and are cue-eligible only in a live non-bulk commit", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows(["a", true], ["b", true], ["c", true], ["d", true], ["e", true]) }));
    const allFlip = step(t, input({ toolRows: rows("a", "b", "c", "d", "e") }));
    expect(allFlip.cueAllowed).toBe(false); // 5 flips = bulk
    const t2 = new ArrivalTracker();
    step(t2, input({ toolRows: rows(["a", true]) }));
    expect(step(t2, input({ toolRows: rows("a") })).cueAllowed).toBe(true);
  });

  it("display-filter toggling never makes an id new: ids come from the UNFILTERED rows (E13)", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("seed") }));
    // Two filtered-out bash calls arrive live; the caller still passes them.
    step(t, input({ toolRows: rows("seed", "bash1", "bash2") }));
    // Toggling the filter changes nothing about arrival.
    const after = step(t, input({ toolRows: rows("seed", "bash1", "bash2") }));
    expect(after.enteringToolIds.size).toBe(0);
  });

  it("re-parenting: a group formed from visible members does not re-enter; a joiner does (E11)", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("c1", "c2") }));
    // 3rd identical call arrives running, then completes → ×N group forms.
    const arrive = step(t, input({ toolRows: rows("c1", "c2", ["c3", true]) }));
    expect([...arrive.enteringToolIds]).toEqual(["c3"]);
    const formed = step(t, input({ toolRows: rows("c1", "c2", "c3") }));
    expect(formed.enteringToolIds.size).toBe(0);
    const joined = step(t, input({ toolRows: rows("c1", "c2", "c3", ["c4", true]) }));
    expect([...joined.enteringToolIds]).toEqual(["c4"]);
  });

  it("steering is a multiset: consume does not animate, a re-add animates exactly once (E12)", () => {
    const t = new ArrivalTracker();
    step(t, input({ steering: ["A", "A"] }));
    const consumed = step(t, input({ steering: ["A"] }));
    expect(consumed.steering.some(Boolean)).toBe(false);
    const readded = step(t, input({ steering: ["A", "A"] }));
    expect(readded.steering).toEqual([false, true]);
  });

  it("edge-detects the pending card, the answer tail and live reasoning against the previous commit", () => {
    const t = new ArrivalTracker();
    step(t, input());
    const d = step(t, input({ hasPendingPrompt: true, hasTail: true, hasThinking: true }));
    expect(d.pendingPrompt && d.tail && d.thinking).toBe(true);
    const later = step(t, input({ hasPendingPrompt: true, hasTail: true, hasThinking: true }));
    expect(later.pendingPrompt || later.tail || later.thinking).toBe(false);
  });

  it("records an arrival that happened while scroll-locked, so it never animates later (E14)", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("seed") }));
    const locked = step(t, input({ toolRows: rows("seed", ["off", true]), following: false }));
    expect(locked.enteringToolIds.size).toBe(0);
    expect(t.hasSeen("off")).toBe(true);
    // Re-follow: a re-render with the same rows has nothing entering.
    expect(step(t, input({ toolRows: rows("seed", "off") })).enteringToolIds.size).toBe(0);
  });

  it("a selection held suppresses entry but still records", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("seed") }));
    const d = step(t, input({ toolRows: rows("seed", "n"), selecting: true }));
    expect(d.enteringToolIds.size).toBe(0);
    expect(t.hasSeen("n")).toBe(true);
  });

  it("a replay-unaware host (no replayInFlight prop) never animates entry or cues (E10)", () => {
    const t = new ArrivalTracker();
    step(t, input({ replayAware: false, toolRows: rows("seed") }));
    const d = step(t, input({ replayAware: false, toolRows: rows("seed", ["live", true]), hasPendingPrompt: true }));
    expect(d.enteringToolIds.size).toBe(0);
    expect(d.pendingPrompt).toBe(false);
    expect(d.cueAllowed).toBe(false);
  });

  it("motion activation re-seeds: arrivals while motion was off or the document hidden never animate (E25)", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("seed") }));
    step(t, input({ toolRows: rows("seed", "while-hidden"), motionActive: false }));
    const back = step(t, input({ toolRows: rows("seed", "while-hidden", "also"), motionActive: true }));
    expect(back.enteringToolIds.size).toBe(0);
    expect(t.hasSeen("also")).toBe(true);
  });

  it("decide is a pure read: repeating it (StrictMode double-render) is stable", () => {
    const t = new ArrivalTracker();
    step(t, input({ toolRows: rows("seed") }));
    const next = input({ toolRows: rows("seed", ["n", true]), steering: ["S"], hasPendingPrompt: true });
    const first = t.decide(next);
    const second = t.decide(next);
    expect([...first.enteringToolIds]).toEqual([...second.enteringToolIds]);
    expect(first.steering).toEqual(second.steering);
    expect(first.pendingPrompt).toBe(second.pendingPrompt);
    // Commit twice (StrictMode effect replay) is idempotent.
    t.commit(next);
    t.commit(next);
    expect(t.decide(next).enteringToolIds.size).toBe(0);
  });

  it("motion off costs nothing: decide returns the shared empty decision", () => {
    const t = new ArrivalTracker();
    expect(t.decide(input({ motionActive: false, toolRows: rows("a") }))).toBe(NO_ARRIVALS);
  });
});
