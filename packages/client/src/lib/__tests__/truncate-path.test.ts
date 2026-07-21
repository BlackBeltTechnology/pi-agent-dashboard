import { describe, it, expect } from "vitest";
import { truncatePathMiddle } from "../util/truncate-path.js";

describe("truncatePathMiddle", () => {
  it("returns path unchanged when within limit", () => {
    expect(truncatePathMiddle("/a/b/c", 20)).toBe("/a/b/c");
  });

  it("returns path unchanged when exactly at limit", () => {
    const p = "/Users/robson/judo";
    expect(truncatePathMiddle(p, p.length)).toBe(p);
  });

  it("truncates middle of long path with ellipsis", () => {
    const result = truncatePathMiddle("/Users/robson/Project/some/deep/nested/judo-meta-esm", 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toContain("…");
    expect(result).toMatch(/\/judo-meta-esm$/);
    expect(result).toMatch(/^\/Users/);
  });

  it("preserves two-segment path unchanged", () => {
    expect(truncatePathMiddle("/judo-ng", 5)).toBe("/judo-ng");
  });

  it("returns empty string for empty input", () => {
    expect(truncatePathMiddle("", 20)).toBe("");
  });

  it("returns root unchanged", () => {
    expect(truncatePathMiddle("/", 20)).toBe("/");
  });

  it("handles single segment (no slashes beyond root)", () => {
    expect(truncatePathMiddle("/verylongdirectoryname", 10)).toBe("/verylongdirectoryname");
  });
});
