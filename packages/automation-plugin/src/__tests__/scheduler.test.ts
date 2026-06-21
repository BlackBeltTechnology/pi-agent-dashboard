/**
 * Trigger registry + central scheduler tests (fake timers).
 *  - registry contains `schedule` at boot
 *  - cron fire invokes onFire once per occurrence
 *  - restart catch-up = skip (no backfill)
 *  - re-arm disposes the prior trigger (no duplicate fire)
 * See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { TriggerRegistry } from "../server/trigger-registry.js";
import { scheduleTrigger } from "../server/schedule-trigger.js";
import { createScheduler } from "../server/scheduler.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

/** A controllable fake clock + timer queue. */
function fakeClock(startMs: number) {
  let nowMs = startMs;
  interface T { id: number; at: number; fn: () => void; cleared: boolean; }
  let seq = 0;
  const timers: T[] = [];
  return {
    now: () => nowMs,
    setTimer(fn: () => void, ms: number) {
      const t: T = { id: ++seq, at: nowMs + ms, fn, cleared: false };
      timers.push(t);
      return { clear: () => { t.cleared = true; } };
    },
    /** Advance time, firing due timers in order. */
    advanceTo(targetMs: number) {
      // Loop because firing a timer may schedule another.
      // Process strictly-due timers up to targetMs.
      for (;;) {
        const due = timers
          .filter((t) => !t.cleared && t.at <= targetMs)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.cleared = true;
        nowMs = due.at;
        due.fn();
      }
      nowMs = targetMs;
    },
  };
}

function scheduleAutomation(name: string, cron: string): DiscoveredAutomation {
  return {
    name,
    scope: "folder",
    dir: `/repo/.pi/automation/${name}`,
    valid: true,
    config: {
      on: { kind: "schedule", cron },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@fast",
      mode: "worktree",
      sandbox: "workspace-write",
      concurrency: "skip",
    },
  };
}

const MIN = 60_000;

describe("TriggerRegistry", () => {
  it("contains `schedule` after registration", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    expect(reg.has("schedule")).toBe(true);
    expect(reg.kinds().has("schedule")).toBe(true);
  });
});

describe("scheduler cron fire", () => {
  it("fires onFire once for a cron occurrence", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    // start at 2026-06-19 10:30:00 local
    const start = new Date(2026, 5, 19, 10, 30, 0).getTime();
    const clock = fakeClock(start);
    const fires: number[] = [];
    const sched = createScheduler({
      registry: reg,
      onFire: (_a, ctx) => fires.push(ctx.firedAt),
      now: clock.now,
      setTimer: clock.setTimer,
    });
    sched.armAll([scheduleAutomation("every-min", "* * * * *")]);

    // advance ~1 minute → exactly one fire at 10:31:00
    clock.advanceTo(start + 1.5 * MIN);
    expect(fires).toHaveLength(1);
    const firstFire = new Date(fires[0]!);
    expect(firstFire.getMinutes()).toBe(31);
    expect(firstFire.getSeconds()).toBe(0);

    // advance another minute → a second, distinct occurrence
    clock.advanceTo(start + 2.5 * MIN);
    expect(fires).toHaveLength(2);
    expect(new Date(fires[1]!).getMinutes()).toBe(32);
  });

  it("re-arm disposes the prior trigger (no duplicate fire)", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    const start = new Date(2026, 5, 19, 10, 30, 0).getTime();
    const clock = fakeClock(start);
    const fires: string[] = [];
    const sched = createScheduler({
      registry: reg,
      onFire: (a, ctx) => fires.push(`${a.config!.on.cron}@${new Date(ctx.firedAt).getMinutes()}`),
      now: clock.now,
      setTimer: clock.setTimer,
    });
    sched.armAll([scheduleAutomation("a", "* * * * *")]);
    // Re-arm same key with a new cron before any fire.
    sched.rearmOne("folder:a", scheduleAutomation("a", "*/2 * * * *"));
    expect(sched.armedKeys()).toEqual(["folder:a"]);

    clock.advanceTo(start + 2.5 * MIN);
    // Only the */2 trigger should have fired (at minute 32), exactly once.
    expect(fires).toEqual(["*/2 * * * *@32"]);
  });

  it("restart catch-up is skip — next fire is in the future, no backfill", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    // 'now' is 10:30:30; a 09:00 daily already passed today → next is tomorrow 09:00
    const start = new Date(2026, 5, 19, 10, 30, 30).getTime();
    const clock = fakeClock(start);
    const fires: number[] = [];
    const sched = createScheduler({
      registry: reg,
      onFire: (_a, ctx) => fires.push(ctx.firedAt),
      now: clock.now,
      setTimer: clock.setTimer,
    });
    sched.armAll([scheduleAutomation("daily", "0 9 * * *")]);

    // Advancing across the rest of today must NOT fire (09:00 already passed).
    clock.advanceTo(new Date(2026, 5, 19, 23, 59, 0).getTime());
    expect(fires).toHaveLength(0);

    // Advancing to tomorrow 09:00 fires once.
    clock.advanceTo(new Date(2026, 5, 20, 9, 1, 0).getTime());
    expect(fires).toHaveLength(1);
    expect(new Date(fires[0]!).getDate()).toBe(20);
  });

  it("isolates an invalid automation (no arm, no throw)", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    const clock = fakeClock(Date.now());
    const sched = createScheduler({ registry: reg, onFire: () => {}, now: clock.now, setTimer: clock.setTimer });
    const invalid: DiscoveredAutomation = { name: "bad", scope: "folder", dir: "/x", valid: false, error: "boom" };
    sched.armAll([invalid, scheduleAutomation("good", "* * * * *")]);
    expect(sched.armedKeys()).toEqual(["folder:good"]);
  });
});
