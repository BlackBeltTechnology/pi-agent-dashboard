/**
 * `decideReap` for plugin-governed / close-requested sessions (test-plan #E7,
 * #E8, #E15): a governed durable session is in scope with its own threshold,
 * every quiescence veto still applies, gears 2/3 fire for it, and a
 * close-requested session skips only the idle-age check — never mid-run.
 * See change: add-session-close-plugin-hook.
 */
import { describe, expect, it } from "vitest";
import { decideReap, type LifecycleSignals, type LifecycleThresholds } from "../quiescence.js";

const T: LifecycleThresholds = { idleTimeoutMs: 60_000, graceWindowMs: 10_000, hardCeilingMs: 600_000 };
const NOW = 10_000_000;

/** A durable, plugin-governed session (threshold 30 s), quiescent and idle 120 s. */
function governed(overrides: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    lifecyclePolicy: undefined,
    governed: true,
    idleTimeoutMs: 30_000,
    lastRunStartedAt: NOW - 500_000,
    lastSettledAt: NOW - 400_000,
    currentTool: null,
    hasPendingAsk: false,
    followUpCount: 0,
    steeringCount: 0,
    hasLiveChild: false,
    hasTerminalInCwd: false,
    hasSubscriber: false,
    activatedAt: NOW - 500_000,
    lastActivityAt: NOW - 120_000,
    cpuIdle: true,
    ...overrides,
  };
}

describe("decideReap — plugin-governed sessions", () => {
  it("undeclared durable session stays out of scope", () => {
    expect(decideReap(governed({ governed: false, idleTimeoutMs: undefined }), T, NOW)).toEqual({
      action: "skip",
      reason: "not-ephemeral",
    });
  });

  it("governed durable session is reaped idle with its own threshold", () => {
    expect(decideReap(governed(), T, NOW)).toEqual({ action: "reap", reason: "idle" });
    // Declared threshold wins over config: idle 45 s > 30 s declared, < 60 s config.
    expect(decideReap(governed({ lastActivityAt: NOW - 45_000 }), T, NOW).action).toBe("reap");
    expect(decideReap(governed({ lastActivityAt: NOW - 20_000 }), T, NOW)).toEqual({
      action: "skip",
      reason: "not-idle-yet",
    });
  });

  it.each<[string, Partial<LifecycleSignals>, string]>([
    ["subscriber", { hasSubscriber: true }, "active-watcher"],
    ["grace window", { activatedAt: NOW - 5_000 }, "grace-window"],
    ["current tool", { currentTool: "bash" }, "current-tool"],
    ["pending ask", { hasPendingAsk: true }, "pending-ask"],
    ["follow-up", { followUpCount: 1 }, "followup-queued"],
    ["steering", { steeringCount: 1 }, "steering-queued"],
    ["terminal in cwd", { hasTerminalInCwd: true }, "terminal-in-cwd"],
    ["live child", { hasLiveChild: true }, "live-child"],
  ])("E7: %s vetoes a governed reap (test-plan #E7)", (_name, veto, reason) => {
    expect(decideReap(governed(veto), T, NOW)).toEqual({ action: "skip", reason });
  });

  it("E8: governed gears 2 and 3 (test-plan #E8)", () => {
    const midRun = { lastRunStartedAt: NOW - 700_000, lastSettledAt: NOW - 800_000 };
    expect(decideReap(governed({ ...midRun, cpuIdle: false }), T, NOW)).toEqual({
      action: "reap",
      reason: "stop-after-turn",
    });
    expect(decideReap(governed({ ...midRun }), T, NOW)).toEqual({ action: "reap", reason: "phantom" });
  });

  it("closeRequested skips only the idle-age check", () => {
    const fresh = { lastActivityAt: NOW - 1_000 };
    // Mode-only (not governed) session with a request, quiescent but freshly active.
    const requested = governed({ governed: false, idleTimeoutMs: undefined, closeRequested: true, ...fresh });
    expect(decideReap(requested, T, NOW)).toEqual({ action: "reap", reason: "idle" });
    // Every other veto still applies.
    expect(decideReap({ ...requested, hasPendingAsk: true }, T, NOW).action).toBe("skip");
    expect(decideReap({ ...requested, hasSubscriber: true }, T, NOW).action).toBe("skip");
  });

  it("E15: a close request never fires mid-run (test-plan #E15)", () => {
    const requestedMidRun = governed({
      governed: false,
      idleTimeoutMs: undefined,
      closeRequested: true,
      lastRunStartedAt: NOW - 5_000,
      lastSettledAt: NOW - 400_000,
      lastActivityAt: NOW - 1_000,
    });
    expect(decideReap(requestedMidRun, T, NOW)).toEqual({ action: "skip", reason: "streaming-active" });
    // After the turn settles, it closes at that quiet point.
    expect(decideReap({ ...requestedMidRun, lastSettledAt: NOW - 500 }, T, NOW)).toEqual({
      action: "reap",
      reason: "idle",
    });
  });
});
