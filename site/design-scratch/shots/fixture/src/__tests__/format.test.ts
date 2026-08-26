import { describe, expect, it } from "vitest";
import { formatBytes, formatCost, formatElapsed, formatTokens, truncate } from "../format.js";

describe("formatBytes", () => {
  it("keeps raw bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("steps up through the unit ladder", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("returns an em dash for nonsense input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatElapsed", () => {
  it("renders seconds, minutes and hours", () => {
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(12 * 60_000)).toBe("12m");
    expect(formatElapsed(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
  });

  it("drops the minute part on a whole hour", () => {
    expect(formatElapsed(3_600_000)).toBe("1h");
  });

  it("collapses to days past 24h", () => {
    expect(formatElapsed(50 * 3_600_000)).toBe("2d");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(15_400)).toBe("15.4k");
    expect(formatTokens(1_100_000)).toBe("1.1M");
  });
});

describe("formatCost", () => {
  it("flags sub-cent spend rather than rounding it to zero", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("prefers a word boundary", () => {
    expect(truncate("the quick brown fox jumps", 20)).toBe("the quick brown…");
  });
});
