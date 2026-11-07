/**
 * Cron evaluator tests (local-time, minute resolution).
 * See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { nextFire, isValidCron, parseCron } from "../server/cron.js";

describe("cron parser", () => {
  it("accepts standard 5-field expressions", () => {
    expect(isValidCron("0 9 * * 1")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 0,12 1-5 * *")).toBe(true);
  });
  it("rejects malformed expressions", () => {
    expect(isValidCron("* * * *")).toBe(false); // 4 fields
    expect(isValidCron("60 * * * *")).toBe(false); // minute out of range
    expect(isValidCron("0 9 * * 9")).toBe(false); // dow out of range
    expect(parseCron("a b c d e")).toBeNull();
  });
  it("normalizes dow 7 to Sunday", () => {
    const f = parseCron("0 0 * * 7")!;
    expect(f.dow.has(0)).toBe(true);
  });
});

describe("nextFire", () => {
  it("fires at the next matching minute strictly after `after`", () => {
    // every minute → next is the following minute
    const after = new Date(2026, 5, 19, 10, 30, 15);
    const next = nextFire("* * * * *", after)!;
    expect(next.getMinutes()).toBe(31);
    expect(next.getSeconds()).toBe(0);
  });

  it("computes the next Monday 09:00 for `0 9 * * 1`", () => {
    // 2026-06-19 is a Friday. Next Monday is 2026-06-22.
    const after = new Date(2026, 5, 19, 12, 0, 0);
    const next = nextFire("0 9 * * 1", after)!;
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(22);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDay()).toBe(1); // Monday
  });

  it("handles step expressions", () => {
    const after = new Date(2026, 5, 19, 10, 7, 0);
    const next = nextFire("*/15 * * * *", after)!;
    expect(next.getMinutes()).toBe(15);
  });

  it("returns null for invalid expressions", () => {
    expect(nextFire("nope", new Date())).toBeNull();
  });
});

// ── Board label formatters ──────────────────────────────────────────────────
// Every row pins `en-GB` and `now` = 2026-11-06 10:00 local, so `<t>` = HH:MM.
// See change: polish-automation-board (design D7, D9).
import {
  humanizeCron,
  relativeFire,
  runDuration,
  runStartLabel,
  sessionHref,
} from "../client/schedule-format.js";

const L = "en-GB";
const NOW = new Date(2026, 10, 6, 10, 0, 0);
const at = (dayOffset: number, h: number, m: number) => new Date(2026, 10, 6 + dayOffset, h, m, 0);
const shortDate = (d: Date) => d.toLocaleDateString(L, { day: "numeric", month: "short" });
const WEEKDAY = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/;

describe("humanizeCron (test-plan #E12)", () => {
  it.each([
    ["*/5 * * * *", "Every 5 minutes"],
    ["15 * * * *", "Hourly at :15"],
    ["20 9 * * *", "Daily at 09:20"],
    ["0 17 * * 1-5", "Weekdays at 17:00"],
    ["0 9 * * 1", "Mondays at 09:00"],
    ["0 8 1 * *", "Monthly on day 1 at 08:00"],
    ["0 9 1-7 * 1", null],
    ["not a cron", null],
  ])("%s → %s", (expr, expected) => {
    expect(humanizeCron(expr)).toBe(expected);
  });
});

describe("runStartLabel (test-plan #E13)", () => {
  it("Today / Yesterday by calendar day, then a short date with no weekday", () => {
    expect(runStartLabel(at(0, 0, 0).getTime(), NOW, L)).toBe("Today 00:00");
    expect(runStartLabel(at(-1, 23, 59).getTime(), NOW, L)).toBe("Yesterday 23:59");
    expect(runStartLabel(at(-1, 0, 0).getTime(), NOW, L)).toBe("Yesterday 00:00");
    for (const back of [2, 8]) {
      const d = at(-back, 9, 20);
      const label = runStartLabel(d.getTime(), NOW, L);
      expect(label).toBe(`${shortDate(d)} 09:20`);
      expect(label).not.toMatch(WEEKDAY);
    }
  });
});

describe("runDuration (test-plan #E14)", () => {
  const s = (n: number) => n * 1000;
  it.each([
    [59, "59s"],
    [60, "1m 00s"],
    [3599, "59m 59s"],
    [3600, "1h 00m"],
    [3912, "1h 05m"],
  ])("%ds → %s", (secs, expected) => {
    expect(runDuration(0, s(secs), NOW.getTime())).toBe(expected);
  });
  it("a running run counts up to now with ' so far'", () => {
    expect(runDuration(NOW.getTime() - s(1080), undefined, NOW.getTime())).toBe("18m 00s so far");
  });
});

describe("relativeFire (test-plan #E15)", () => {
  it("today / tomorrow / short date", () => {
    expect(relativeFire(at(0, 16, 30), NOW, L)).toBe("today 16:30");
    expect(relativeFire(at(1, 9, 20), NOW, L)).toBe("tomorrow 09:20");
    const d = at(3, 9, 20);
    expect(relativeFire(d, NOW, L)).toBe(`${shortDate(d)} 09:20`);
  });
});

describe("sessionHref (test-plan #E16)", () => {
  const run = (status: "running" | "done" | "error" | "stopped", extra: Record<string, unknown> = {}) => ({
    sessionId: "s1",
    status,
    ...extra,
  });
  it("live link only for a running tracked run; archived view otherwise; null without a session", () => {
    expect(sessionHref(run("running", { tracked: true }))).toBe("/session/s1");
    expect(sessionHref(run("running", { tracked: false }))).toBe("/session/s1?archived=1");
    expect(sessionHref(run("running", { tracked: false, orphaned: true }))).toBe("/session/s1?archived=1");
    expect(sessionHref(run("done"))).toBe("/session/s1?archived=1");
    expect(sessionHref(run("error"))).toBe("/session/s1?archived=1");
    expect(sessionHref(run("stopped"))).toBe("/session/s1?archived=1");
    expect(sessionHref({ status: "done" })).toBeNull();
  });
});
