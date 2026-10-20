/**
 * Replay exit controller — idle (5 s, busy re-check) and cap (60 s) fallback
 * exits, one timer set per session, flush bookkeeping.
 * See change: fix-large-session-resume-replay (D2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReplayExitController,
  REPLAY_CAP_MS,
  REPLAY_IDLE_MS,
  type ReplayExitCause,
} from "../replay-exit-controller.js";

function setup() {
  const exits: Array<{ id: string; cause: ReplayExitCause; at: number }> = [];
  const controller = createReplayExitController({ now: () => Date.now(), setImmediate: (fn) => fn() });
  controller.setOnExit((id, cause) => exits.push({ id, cause, at: Date.now() }));
  return { controller, exits };
}

describe("replay-exit-controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the documented constants", () => {
    expect(REPLAY_IDLE_MS).toBe(5_000);
    expect(REPLAY_CAP_MS).toBe(60_000);
  });

  // test-plan #E5
  it("E5: idle exit fires 5 s after the last touch, not a millisecond earlier", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    vi.advanceTimersByTime(4_999);
    controller.touch("s1");
    vi.advanceTimersByTime(1); // t = 5_000
    expect(exits).toEqual([]);
    expect(controller.replayingSessions.has("s1")).toBe(true);
    vi.advanceTimersByTime(4_998); // t = 9_998
    expect(exits).toEqual([]);
    vi.advanceTimersByTime(1); // t = 9_999
    expect(exits).toEqual([{ id: "s1", cause: "idle", at: 9_999 }]);
    expect(controller.replayingSessions.has("s1")).toBe(false);
  });

  // test-plan #E6
  it("E6: cap exit fires at 60 s even while events keep arriving", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    for (let t = 1_000; t < REPLAY_CAP_MS; t += 1_000) {
      vi.advanceTimersByTime(1_000);
      controller.touch("s1");
    }
    vi.advanceTimersByTime(999); // t = 59_999
    expect(exits).toEqual([]);
    vi.advanceTimersByTime(1); // t = 60_000
    expect(exits).toEqual([{ id: "s1", cause: "cap", at: 60_000 }]);
  });

  // test-plan #E10
  it("E10: a non-event bridge message (prompt re-send) keeps the replay alive", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    for (let t = 2_000; t <= 6_000; t += 2_000) {
      vi.advanceTimersByTime(2_000);
      controller.touch("s1"); // prompt_request every 2 s, no event_forward at all
    }
    expect(exits).toEqual([]);
  });

  it("replay_complete cancels the pending exit; a later exit is a no-op", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    controller.complete("s1");
    expect(exits.map((e) => e.cause)).toEqual(["complete"]);
    vi.advanceTimersByTime(120_000);
    controller.complete("s1");
    expect(exits.map((e) => e.cause)).toEqual(["complete"]);
  });

  it("a new begin cancels the previous register's timers", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    controller.complete("s1");
    vi.advanceTimersByTime(4_000);
    controller.begin("s1", { skipped: false });
    vi.advanceTimersByTime(1_300); // old idle timer would have fired at 5_000
    expect(exits.map((e) => e.cause)).toEqual(["complete"]);
    expect(controller.replayingSessions.has("s1")).toBe(true);
  });

  it("busy re-check: input handled in the setImmediate re-check re-arms the idle period", () => {
    const queue: Array<() => void> = [];
    let clock = 0;
    const exits: ReplayExitCause[] = [];
    const controller = createReplayExitController({
      now: () => clock,
      setImmediate: (fn) => queue.push(fn),
    });
    controller.setOnExit((_id, cause) => exits.push(cause));
    controller.begin("s1", { skipped: false });
    vi.advanceTimersByTime(5_000);
    clock = 5_000;
    // The idle timer is due; queued input is handled before the re-check runs.
    controller.touch("s1");
    queue.shift()!();
    expect(exits).toEqual([]);
    expect(controller.replayingSessions.has("s1")).toBe(true);
  });

  it("reopen re-enters replay mode for a non-skipped register only", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    for (let t = 1_000; t < REPLAY_CAP_MS; t += 1_000) {
      vi.advanceTimersByTime(1_000);
      controller.touch("s1");
    }
    vi.advanceTimersByTime(1_000);
    expect(exits.map((e) => e.cause)).toEqual(["cap"]);
    expect(controller.reopen("s1")).toBe(true);
    expect(controller.replayingSessions.has("s1")).toBe(true);
    controller.complete("s1");
    expect(exits.map((e) => e.cause)).toEqual(["cap", "complete"]);

    controller.begin("s2", { skipped: true });
    controller.complete("s2");
    expect(controller.reopen("s2")).toBe(false);
    expect(controller.isSkipped("s2")).toBe(true); // skip flag outlives the exit
    controller.begin("s2", { skipped: false });
    expect(controller.isSkipped("s2")).toBe(false);
  });

  it("flush bookkeeping: a wipe sets pending, completion clears it, a superseding begin keeps it", () => {
    const { controller } = setup();
    controller.begin("s1", { skipped: false });
    expect(controller.isFlushPending("s1")).toBe(true);
    const flush = controller.startFlush("s1");
    controller.begin("s1", { skipped: true }); // supersedes the draining flush
    expect(flush.isStale()).toBe(true);
    flush.finish(); // stale finish must not clear pending
    expect(controller.isFlushPending("s1")).toBe(true);
    const next = controller.startFlush("s1");
    expect(next.isStale()).toBe(false);
    next.finish();
    expect(controller.isFlushPending("s1")).toBe(false);
  });

  it("release exits an active replay with cause unregister, stops waiters, drops the record", () => {
    const { controller, exits } = setup();
    controller.begin("s1", { skipped: false });
    const stop = vi.fn();
    controller.addWaiter("s1", stop);
    controller.release("s1");
    expect(exits.map((e) => e.cause)).toEqual(["unregister"]);
    expect(stop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120_000);
    expect(exits).toHaveLength(1);
    expect(controller.isSkipped("s1")).toBe(false);
    expect(controller.isFlushPending("s1")).toBe(false);
  });

  it("an exit stops waiters before the owner flushes", () => {
    const order: string[] = [];
    const controller = createReplayExitController();
    controller.setOnExit(() => order.push("exit"));
    controller.begin("s1", { skipped: false });
    controller.addWaiter("s1", () => order.push("stop"));
    controller.complete("s1");
    expect(order).toEqual(["stop", "exit"]);
  });
});
