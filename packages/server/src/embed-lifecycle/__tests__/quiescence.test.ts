/**
 * Reap-decision core (test-plan #E1, #E12, #E15, #F1, #F2, #F3, #X4, #X5).
 * `decideReap` is the pure heart of the reaper; this suite is the decision
 * table + one-signal-veto matrix + BVA boundary that proves gear selection and
 * every veto without a server instance.
 * See change: add-embed-session-lifecycle.
 */
import { describe, expect, it } from "vitest";
import {
  decideReap,
  isAtRest,
  type LifecycleSignals,
  type LifecycleThresholds,
} from "../quiescence.js";

const T: LifecycleThresholds = {
  idleTimeoutMs: 60_000,
  graceWindowMs: 10_000,
  hardCeilingMs: 600_000,
};
const NOW = 10_000_000;

/** A fully quiescent, idle, past-grace ephemeral session (the reap baseline). */
function quiescent(overrides: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    lifecyclePolicy: "ephemeral",
    lastRunStartedAt: NOW - 500_000,
    lastSettledAt: NOW - 400_000, // settled after start ⇒ at rest
    currentTool: null,
    hasPendingAsk: false,
    followUpCount: 0,
    steeringCount: 0,
    hasLiveChild: false,
    hasTerminalInCwd: false,
    hasSubscriber: false,
    activatedAt: NOW - 500_000, // well past grace
    lastActivityAt: NOW - 120_000, // idle age 120s > 60s timeout
    cpuIdle: true,
    ...overrides,
  };
}

/** A streaming (mid-run, unsettled) session. */
function streaming(overrides: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return quiescent({
    lastRunStartedAt: NOW - 700_000, // started, no later settle
    lastSettledAt: NOW - 800_000, // older than start ⇒ mid-run
    ...overrides,
  });
}

describe("isAtRest", () => {
  it("is at rest when a settle is the latest run signal", () => {
    expect(isAtRest({ lastRunStartedAt: 100, lastSettledAt: 200 })).toBe(true);
  });
  it("is mid-run when a start is newer than the last settle", () => {
    expect(isAtRest({ lastRunStartedAt: 300, lastSettledAt: 200 })).toBe(false);
  });
  it("is at rest when a run never started", () => {
    expect(isAtRest({})).toBe(true);
  });
  it("is mid-run when a run started but never settled", () => {
    expect(isAtRest({ lastRunStartedAt: 300 })).toBe(false);
  });
});

describe("decideReap — gear 1 (idle)", () => {
  // E1 / E12 — eligible idle ephemeral is reaped.
  it("reaps a fully quiescent idle ephemeral session", () => {
    expect(decideReap(quiescent(), T, NOW)).toEqual({ action: "reap", reason: "idle" });
  });

  // E1 — durable/absent is never reaped.
  it("skips a durable session", () => {
    expect(decideReap(quiescent({ lifecyclePolicy: "durable" }), T, NOW).action).toBe("skip");
    expect(decideReap(quiescent({ lifecyclePolicy: undefined }), T, NOW).action).toBe("skip");
  });

  // E12 — BVA boundary: age == timeout is NOT reaped; timeout+1 IS.
  it("does not reap at exactly the idle timeout, reaps just past it", () => {
    const atBoundary = quiescent({ lastActivityAt: NOW - T.idleTimeoutMs });
    expect(decideReap(atBoundary, T, NOW).action).toBe("skip");
    const pastBoundary = quiescent({ lastActivityAt: NOW - T.idleTimeoutMs - 1 });
    expect(decideReap(pastBoundary, T, NOW)).toEqual({ action: "reap", reason: "idle" });
  });
});

describe("decideReap — X4 one-signal-veto matrix", () => {
  // Flipping active generation on the idle baseline makes it a stalled stream;
  // the quiescence gate must veto the LOSSY gear-1 idle reap (it may instead be
  // gracefully stopped after its turn — never idle-hard-killed).
  it("does NOT idle-reap an actively-generating session", () => {
    const verdict = decideReap(quiescent({ lastRunStartedAt: NOW - 100 }), T, NOW);
    expect(verdict).not.toEqual({ action: "reap", reason: "idle" });
  });

  // Each flip of a single busy signal on the otherwise-reapable (at-rest)
  // baseline must block the reap outright.
  const cases: Array<[string, Partial<LifecycleSignals>, string]> = [
    ["current tool executing", { currentTool: "bash" }, "current-tool"],
    ["pending ask_user", { hasPendingAsk: true }, "pending-ask"],
    ["queued follow-up", { followUpCount: 1 }, "followup-queued"],
    ["queued steering", { steeringCount: 1 }, "steering-queued"],
    ["live terminal in cwd", { hasTerminalInCwd: true }, "terminal-in-cwd"],
    ["live child process", { hasLiveChild: true }, "live-child"],
    ["active watcher", { hasSubscriber: true }, "active-watcher"],
    ["within grace window", { activatedAt: NOW - 1 }, "grace-window"],
  ];
  for (const [label, flip, reason] of cases) {
    it(`does NOT reap: ${label}`, () => {
      const verdict = decideReap(quiescent(flip), T, NOW);
      expect(verdict.action).toBe("skip");
      expect((verdict as { reason: string }).reason).toBe(reason);
    });
  }
});

describe("decideReap — gear 3 (phantom)", () => {
  // E15 — wedged streaming past the hard ceiling, ~0 CPU, no child, no watcher,
  // no ask, empty queues ⇒ phantom.
  it("force-reaps a wedged streaming session as phantom", () => {
    const phantom = streaming({ lastRunStartedAt: NOW - (T.hardCeilingMs + 1) });
    expect(decideReap(phantom, T, NOW)).toEqual({ action: "reap", reason: "phantom" });
  });

  // X5 — pending ask blocks phantom even past the ceiling.
  it("does NOT phantom-reap a session blocked on ask_user", () => {
    const blocked = streaming({
      lastRunStartedAt: NOW - (T.hardCeilingMs + 1),
      hasPendingAsk: true,
    });
    expect(decideReap(blocked, T, NOW).action).toBe("skip");
  });

  // X5 — non-empty queue blocks phantom.
  it("does NOT phantom-reap a session with queued work", () => {
    const queued = streaming({
      lastRunStartedAt: NOW - (T.hardCeilingMs + 1),
      followUpCount: 2,
    });
    expect(decideReap(queued, T, NOW).action).toBe("skip");
  });

  // Phantom requires ~0 CPU: a busy tree past the ceiling is never force-reaped
  // as phantom (it may still be gracefully stopped after its turn).
  it("does NOT phantom-reap a CPU-busy streaming session", () => {
    const busy = streaming({ lastRunStartedAt: NOW - (T.hardCeilingMs + 1), cpuIdle: false });
    const verdict = decideReap(busy, T, NOW);
    expect(verdict).not.toEqual({ action: "reap", reason: "phantom" });
  });
});

describe("decideReap — gear 2 (stop-after-turn)", () => {
  // F1 — idle-trending streaming, empty queues, no watcher, past timeout ⇒ stop.
  it("sends stop-after-turn for an idle-trending streaming session", () => {
    const idleStream = streaming({ lastRunStartedAt: NOW - 100_000 }); // past idle, below ceiling
    expect(decideReap(idleStream, T, NOW)).toEqual({
      action: "reap",
      reason: "stop-after-turn",
    });
  });

  // F2 — streaming with a non-empty queue is NOT stopped (drains first).
  it("does NOT stop a streaming session with queued follow-up", () => {
    const queued = streaming({ lastRunStartedAt: NOW - 100_000, followUpCount: 1 });
    expect(decideReap(queued, T, NOW).action).toBe("skip");
  });

  // F3 — a streaming session below the idle timeout is left alone (disconnect
  // alone never reclaims; only quiescence + timeout does).
  it("does NOT stop a recently-active streaming session", () => {
    const recent = streaming({ lastRunStartedAt: NOW - 5_000, lastActivityAt: NOW - 1_000 });
    expect(decideReap(recent, T, NOW).action).toBe("skip");
  });
});
