/**
 * Readiness poll lifecycle — folded from test-plan.md
 * (add-zrok-custom-reserved-name): F1–F3, F6 (the label arm), plus 6.4/6.5.
 *
 * A tick shells out per provider, so the expensive question is not "does it
 * poll" but "does it ever poll when nobody is looking". These assert the two
 * ways that leaks: a timer that outlives the dialog, and an in-flight tick that
 * gets overtaken by its own successor (a tick is bounded at 4s per provider
 * against a 5s interval, so overlap is reachable, not theoretical).
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_POLL_STATE,
  nextAction,
  onClose,
  onOpen,
  onTickError,
  onTickResult,
  onTickStart,
  READINESS_LABEL,
  readinessSeverity,
  secondsSinceCheck,
  shouldTick,
} from "../gateway/readiness-poll.js";

const BOARD = [
  { provider: "zrok" as const, state: "connected" as const, endpoints: [] },
  { provider: "ngrok" as const, state: "not-installed" as const, endpoints: [] },
];

describe("F1: opening ticks immediately", () => {
  it("permits a tick as soon as the dialog is open", () => {
    expect(shouldTick(onOpen(INITIAL_POLL_STATE))).toBe(true);
  });

  it("permits nothing while closed — not even the first tick", () => {
    expect(shouldTick(INITIAL_POLL_STATE)).toBe(false);
  });
});

describe("F2: closing stops polling", () => {
  it("refuses to tick once closed", () => {
    const closed = onClose(onOpen(INITIAL_POLL_STATE));
    expect(shouldTick(closed)).toBe(false);
  });

  it("DISCARDS a result that lands after close, rather than repopulating a hidden board", () => {
    const open = onTickStart(onOpen(INITIAL_POLL_STATE));
    const closed = onClose(open);
    const after = onTickResult(closed, BOARD, 1000);
    expect(after.providers).toEqual([]);
    expect(after.lastCheckedAt).toBeUndefined();
  });

  it("clears in-flight on close, or the NEXT open's first tick is suppressed forever", () => {
    // The response that would have cleared the flag is discarded, so leaving it
    // set would deadlock the reopened dialog at a permanently blank board.
    const closed = onClose(onTickStart(onOpen(INITIAL_POLL_STATE)));
    expect(closed.inFlight).toBe(false);
    expect(shouldTick(onOpen(closed))).toBe(true);
  });
});

describe("F3: overlapping ticks are suppressed", () => {
  it("refuses a second tick while one is in flight", () => {
    expect(shouldTick(onTickStart(onOpen(INITIAL_POLL_STATE)))).toBe(false);
  });

  it("permits the next tick once the in-flight one resolves", () => {
    const s = onTickResult(onTickStart(onOpen(INITIAL_POLL_STATE)), BOARD, 1000);
    expect(s.inFlight).toBe(false);
    expect(shouldTick(s)).toBe(true);
  });

  it("permits the next tick after a FAILED one — a failure must not wedge the poll", () => {
    const s = onTickError(onTickStart(onOpen(INITIAL_POLL_STATE)));
    expect(shouldTick(s)).toBe(true);
  });

  it("keeps the last good board when a tick fails, rather than blanking it", () => {
    const good = onTickResult(onTickStart(onOpen(INITIAL_POLL_STATE)), BOARD, 1000);
    const failed = onTickError(onTickStart(good));
    expect(failed.providers).toEqual(BOARD);
  });
});

describe("the freshness stamp", () => {
  it("reports nothing before the first completed tick", () => {
    expect(secondsSinceCheck(INITIAL_POLL_STATE, 5000)).toBeNull();
  });

  it("counts whole seconds since the last completed tick", () => {
    const s = onTickResult(onTickStart(onOpen(INITIAL_POLL_STATE)), BOARD, 10_000);
    expect(secondsSinceCheck(s, 10_000)).toBe(0);
    expect(secondsSinceCheck(s, 17_400)).toBe(7);
  });

  it("never reports a negative age if the clock jumps backwards", () => {
    const s = onTickResult(onTickStart(onOpen(INITIAL_POLL_STATE)), BOARD, 10_000);
    expect(secondsSinceCheck(s, 9_000)).toBe(0);
  });
});

describe("F6: every state carries a text label, never colour alone", () => {
  it("labels all four states", () => {
    expect(Object.keys(READINESS_LABEL).sort()).toEqual([
      "connected",
      "disconnected",
      "not-installed",
      "not-set",
    ]);
    for (const [state, label] of Object.entries(READINESS_LABEL)) {
      expect(label.trim().length, state).toBeGreaterThan(0);
    }
  });

  it("gives each state a DISTINCT label — two states sharing text is colour-only in disguise", () => {
    const labels = Object.values(READINESS_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("maps each state to one outstanding action, and connected to none", () => {
    expect(nextAction("not-installed")).toBe("install");
    expect(nextAction("not-set")).toBe("enroll");
    expect(nextAction("disconnected")).toBe("connect");
    expect(nextAction("connected")).toBeNull();
  });

  it("treats disconnected as neutral — a tunnel you have not started is not a fault", () => {
    expect(readinessSeverity("connected")).toBe("success");
    expect(readinessSeverity("disconnected")).toBe("neutral");
    expect(readinessSeverity("not-installed")).toBe("warning");
    expect(readinessSeverity("not-set")).toBe("warning");
  });
});
