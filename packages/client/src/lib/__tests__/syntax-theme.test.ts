import { describe, it, expect } from "vitest";
import { getSyntaxTheme } from "../syntax-theme.js";

const DARK_THEMES = ["base", "dracula", "nord", "github", "catppuccin", "tokyo-night", "rose-pine", "solarized", "gruvbox"] as const;
const LIGHT_THEMES = ["base", "dracula", "nord", "github", "catppuccin", "tokyo-night", "rose-pine", "solarized", "gruvbox"] as const;

function tokenSelectors(style: Record<string, unknown>): string[] {
  return Object.keys(style).filter((k) => k.includes(".token"));
}

describe("getSyntaxTheme", () => {
  describe("strips token-level backgrounds", () => {
    for (const name of DARK_THEMES) {
      it(`dark / ${name}: no .token* selector retains background or backgroundColor`, () => {
        const style = getSyntaxTheme("dark", name) as Record<string, Record<string, unknown>>;
        const selectors = tokenSelectors(style);
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
          expect(style[sel]).not.toHaveProperty("background");
          expect(style[sel]).not.toHaveProperty("backgroundColor");
        }
      });
    }

    for (const name of LIGHT_THEMES) {
      it(`light / ${name}: no .token* selector retains background or backgroundColor`, () => {
        const style = getSyntaxTheme("light", name) as Record<string, Record<string, unknown>>;
        const selectors = tokenSelectors(style);
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
          expect(style[sel]).not.toHaveProperty("background");
          expect(style[sel]).not.toHaveProperty("backgroundColor");
        }
      });
    }
  });

  it("preserves the wrapper background on pre[class*='language-']", () => {
    const style = getSyntaxTheme("dark", "base") as Record<string, Record<string, unknown>>;
    const wrapperKey = Object.keys(style).find((k) => k.startsWith("pre[class*=") && !k.includes(".token"));
    expect(wrapperKey).toBeDefined();
    const wrapper = style[wrapperKey!];
    // Either background or backgroundColor MUST still be present (the strip is token-only).
    const hasBg = "background" in wrapper || "backgroundColor" in wrapper;
    expect(hasBg).toBe(true);
  });

  it("strips diff-wash backgrounds on .token.deleted and .token.inserted", () => {
    const style = getSyntaxTheme("dark", "base") as Record<string, Record<string, unknown>>;
    for (const sel of [".token.deleted", ".token.inserted"]) {
      if (style[sel]) {
        expect(style[sel]).not.toHaveProperty("background");
        expect(style[sel]).not.toHaveProperty("backgroundColor");
      }
    }
  });

  it("returns a fallback style for unknown themes", () => {
    const style = getSyntaxTheme("dark", "definitely-not-a-theme") as Record<string, Record<string, unknown>>;
    const selectors = tokenSelectors(style);
    for (const sel of selectors) {
      expect(style[sel]).not.toHaveProperty("background");
      expect(style[sel]).not.toHaveProperty("backgroundColor");
    }
  });
});
