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
import { createScheduler, setLongTimer, MAX_DELAY as SCHED_MAX_DELAY } from "../server/scheduler.js";
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

/**
 * A faithful raw timer + controllable clock. Unlike `overflowClock` it honors
 * any delay (it stands in for the low-level hop primitive that `setLongTimer`
 * drives). `jumpTo`+`flush` simulate an OS suspend that leaps the wall clock
 * past a pending hop's scheduled instant.
 */
function rawClock(startMs: number) {
  let nowMs = startMs;
  interface T { id: number; at: number; fn: () => void; cleared: boolean; }
  let seq = 0;
  const timers: T[] = [];
  const fireDue = () => {
    for (;;) {
      const due = timers.filter((t) => !t.cleared && t.at <= nowMs).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cleared = true;
      due.fn();
    }
  };
  return {
    now: () => nowMs,
    raw(fn: () => void, ms: number) {
      const t: T = { id: ++seq, at: nowMs + ms, fn, cleared: false };
      timers.push(t);
      return { clear: () => { t.cleared = true; } };
    },
    advanceTo(targetMs: number) {
      for (;;) {
        const due = timers.filter((t) => !t.cleared && t.at <= targetMs).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.cleared = true;
        nowMs = due.at;
        due.fn();
      }
      nowMs = targetMs;
    },
    /** Leap the clock without firing (simulates suspend), then flush due timers. */
    jumpTo(targetMs: number) { nowMs = targetMs; fireDue(); },
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
const MAX_DELAY = 2_147_483_647; // 2^31 - 1 — Node's setTimeout ceiling

/**
 * A fake clock whose `setTimer` mimics Node's real `setTimeout`: a delay past
 * the 32-bit ceiling is clamped to ~1ms (Node emits TimeoutOverflowWarning and
 * fires almost immediately). Used to reproduce the overflow firing-storm.
 * See change: fix-schedule-timer-overflow.
 */
function overflowClock(startMs: number) {
  let nowMs = startMs;
  interface T { id: number; at: number; fn: () => void; cleared: boolean; }
  let seq = 0;
  const timers: T[] = [];
  return {
    now: () => nowMs,
    setTimer(fn: () => void, ms: number) {
      const eff = ms > MAX_DELAY ? 1 : ms; // simulate the 32-bit clamp
      const t: T = { id: ++seq, at: nowMs + eff, fn, cleared: false };
      timers.push(t);
      return { clear: () => { t.cleared = true; } };
    },
    advanceTo(targetMs: number) {
      let guard = 0;
      for (;;) {
        const due = timers
          .filter((t) => !t.cleared && t.at <= targetMs)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        // A correct chunked timer needs only a handful of hops to span any
        // horizon; anything past this bound means the overflow storm is back.
        if (++guard > 200) throw new Error("timer storm: overflow re-arm loop");
        due.cleared = true;
        nowMs = due.at;
        due.fn();
      }
      nowMs = targetMs;
    },
  };
}

describe("setLongTimer", () => {
  it("honors a delay beyond the 32-bit ceiling, firing once at the target", () => {
    const c = rawClock(0);
    let fires = 0;
    const delay = SCHED_MAX_DELAY * 3 + 1234; // ~74 days — needs multiple hops
    setLongTimer(c.raw, c.now, () => { fires++; }, delay);

    c.advanceTo(delay - 1);
    expect(fires).toBe(0); // still waiting — no early fire
    c.advanceTo(delay);
    expect(fires).toBe(1); // fires exactly at the target
    c.advanceTo(delay + SCHED_MAX_DELAY * 2);
    expect(fires).toBe(1); // no re-fire after the target
  });

  it("fires in a single hop exactly at the MAX_DELAY boundary (no extra hop)", () => {
    // remaining === MAX_DELAY takes the `> MAX_DELAY` false branch — one final
    // raw(fn, MAX_DELAY), not a MAX-hop followed by a 0ms hop.
    const c = rawClock(0);
    let fires = 0;
    setLongTimer(c.raw, c.now, () => { fires++; }, SCHED_MAX_DELAY);
    c.advanceTo(SCHED_MAX_DELAY - 1);
    expect(fires).toBe(0);
    c.advanceTo(SCHED_MAX_DELAY);
    expect(fires).toBe(1);
  });

  it("fires once immediately when a hop wakes past the target (late arrival)", () => {
    const c = rawClock(0);
    let fires = 0;
    const delay = SCHED_MAX_DELAY * 2; // target = 2 * MAX
    setLongTimer(c.raw, c.now, () => { fires++; }, delay);

    // Machine suspended: the wall clock leaps past the target while the first
    // hop is still pending. On wake the recomputed remaining is negative.
    c.jumpTo(delay + 10 * MIN);
    expect(fires).toBe(1);

    c.advanceTo(delay + SCHED_MAX_DELAY * 3);
    expect(fires).toBe(1); // exactly one fire for the occurrence
  });

  it("clear() cancels the pending hop mid-wait (no fire after dispose)", () => {
    const c = rawClock(0);
    let fires = 0;
    const h = setLongTimer(c.raw, c.now, () => { fires++; }, SCHED_MAX_DELAY * 3);
    c.advanceTo(SCHED_MAX_DELAY * 1.5); // one hop elapsed, next hop pending
    h.clear();
    c.advanceTo(SCHED_MAX_DELAY * 5);
    expect(fires).toBe(0);
  });
});

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

  it("long-horizon cron fires once at its occurrence (no overflow storm)", () => {
    // A yearly cron whose next fire is ~6 months out — far past the 24.855-day
    // 32-bit setTimeout ceiling. With the raw (unclamped) timer this overflowed
    // to an immediate firing storm; the chunked long-timeout fires once.
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    const start = new Date(2026, 5, 19, 10, 0, 0).getTime(); // 2026-06-19 10:00
    const clock = overflowClock(start);
    const fires: number[] = [];
    const sched = createScheduler({
      registry: reg,
      onFire: (_a, ctx) => fires.push(ctx.firedAt),
      now: clock.now,
      setTimer: clock.setTimer,
    });
    sched.armAll([scheduleAutomation("yearly", "0 0 1 1 *")]);
    const target = new Date(2027, 0, 1, 0, 0, 0).getTime(); // next: 2027-01-01 00:00

    clock.advanceTo(target + MIN);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toBe(target);

    // No further fire before the following year's occurrence.
    clock.advanceTo(target + 30 * 24 * 60 * MIN);
    expect(fires).toHaveLength(1);
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
