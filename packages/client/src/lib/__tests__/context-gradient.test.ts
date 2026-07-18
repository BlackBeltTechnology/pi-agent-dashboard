import { describe, it, expect } from "vitest";
import { contextGradientColor } from "../theme/context-gradient.js";

describe("contextGradientColor", () => {
  it("returns green at 0%", () => {
    expect(contextGradientColor(0)).toBe("hsl(142, 71%, 45%)");
  });

  it("returns yellow at 50%", () => {
    expect(contextGradientColor(50)).toBe("hsl(48, 96%, 53%)");
  });

  it("returns red at 100%", () => {
    expect(contextGradientColor(100)).toBe("hsl(0, 84%, 60%)");
  });

  it("returns green-ish at 20%", () => {
    const color = contextGradientColor(20);
    // Should be between green and yellow
    expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    // Hue should be between 48 and 142
    const hue = parseInt(color.match(/hsl\((\d+)/)?.[1] ?? "0");
    expect(hue).toBeGreaterThan(48);
    expect(hue).toBeLessThan(142);
  });

  it("returns orange-ish at 80%", () => {
    const color = contextGradientColor(80);
    const hue = parseInt(color.match(/hsl\((\d+)/)?.[1] ?? "0");
    // Should be between 0 and 48 (yellow to red range)
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(48);
  });

  it("clamps below 0%", () => {
    expect(contextGradientColor(-10)).toBe(contextGradientColor(0));
  });

  it("clamps above 100%", () => {
    expect(contextGradientColor(120)).toBe(contextGradientColor(100));
  });
});
