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
