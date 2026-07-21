import { describe, it, expect } from "vitest";
import { formatTokens, formatRelativeTime, formatMessageTime } from "../util/format.js";

describe("formatTokens", () => {
  it("should return '0' for zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("should return raw number below 1000", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("should format thousands with k suffix", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(12400)).toBe("12.4k");
    expect(formatTokens(100000)).toBe("100k");
  });

  it("should drop decimal when it would be .0", () => {
    expect(formatTokens(5000)).toBe("5k");
    expect(formatTokens(10000)).toBe("10k");
  });

  it("should handle undefined/NaN gracefully", () => {
    expect(formatTokens(undefined as any)).toBe("0");
    expect(formatTokens(NaN)).toBe("0");
  });
});

describe("formatRelativeTime", () => {
  it("should show seconds for < 60s", () => {
    expect(formatRelativeTime(30_000)).toBe("30s");
    expect(formatRelativeTime(5_000)).toBe("5s");
  });

  it("should show minutes for < 60m", () => {
    expect(formatRelativeTime(60_000)).toBe("1m");
    expect(formatRelativeTime(180_000)).toBe("3m");
    expect(formatRelativeTime(3_540_000)).toBe("59m");
  });

  it("should show hours for >= 60m", () => {
    expect(formatRelativeTime(3_600_000)).toBe("1h");
    expect(formatRelativeTime(7_200_000)).toBe("2h");
  });

  it("should show days for >= 24h", () => {
    expect(formatRelativeTime(86_400_000)).toBe("1d");
    expect(formatRelativeTime(172_800_000)).toBe("2d");
  });

  it("should return '0s' for zero or negative", () => {
    expect(formatRelativeTime(0)).toBe("0s");
    expect(formatRelativeTime(-1000)).toBe("0s");
  });
});

describe("formatMessageTime", () => {
  // Helper: create a date relative to "now"
  function makeNow(y: number, m: number, d: number, h = 12, min = 0, s = 0) {
    return new Date(y, m - 1, d, h, min, s).getTime();
  }

  it("should show only HH:MM:SS for today", () => {
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2026, 3, 25, 9, 5, 30);
    expect(formatMessageTime(ts, now)).toBe("09:05:30");
  });

  it("should show 'Yesterday HH:MM:SS' for yesterday", () => {
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2026, 3, 24, 14, 32, 5);
    expect(formatMessageTime(ts, now)).toBe("Yesterday 14:32:05");
  });

  it("should show weekday + HH:MM:SS for 2-6 days ago (same week)", () => {
    // 2026-03-25 is a Wednesday. Monday the 23rd is 2 days ago.
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2026, 3, 23, 8, 0, 0);
    expect(formatMessageTime(ts, now)).toBe("Monday 08:00:00");
  });

  it("should show weekday for up to 6 days ago", () => {
    // 2026-03-25 (Wed). 6 days ago = Thu 2026-03-19
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2026, 3, 19, 22, 15, 45);
    expect(formatMessageTime(ts, now)).toBe("Thursday 22:15:45");
  });

  it("should show full date for 7+ days ago", () => {
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2026, 3, 18, 14, 32, 5);
    expect(formatMessageTime(ts, now)).toBe("2026-03-18 14:32:05");
  });

  it("should show full date for a different year", () => {
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2025, 12, 31, 23, 59, 59);
    expect(formatMessageTime(ts, now)).toBe("2025-12-31 23:59:59");
  });

  it("should pad single-digit hours, minutes, seconds", () => {
    const now = makeNow(2026, 3, 25, 15, 0, 0);
    const ts = makeNow(2026, 3, 25, 1, 2, 3);
    expect(formatMessageTime(ts, now)).toBe("01:02:03");
  });
});
