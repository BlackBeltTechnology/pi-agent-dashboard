import { describe, it, expect } from "vitest";
import { getSyntaxTheme } from "../syntax-theme.js";

const DARK_THEMES = ["base", "dracula", "nord", "github", "catppuccin", "tokyo-night", "rose-pine", "solarized", "gruvbox"] as const;
const LIGHT_THEMES = ["base", "dracula", "nord", "github", "catppuccin", "tokyo-night", "rose-pine", "solarized", "gruvbox"] as const;

function tokenSelectors(style: Record<string, unknown>): string[] {
  return Object.keys(style).filter((k) => k.includes(".token"));
}

describe("getSyntaxTheme", () => {
  describe("strips token-level backgrounds", () => {
    // Themes whose prism style uses `.token`-prefixed selectors. The base
    // "oneDark" / "oneLight" palette covers most; some themes
    // (gruvbox, solarized-light) ship without `.token` substrings at all,
    // and for those the strip is vacuously correct — we still iterate to
    // pin the no-background invariant on whatever selectors are present.
    const TOKEN_BEARING = new Set(["base", "dracula", "nord", "github", "catppuccin", "tokyo-night", "rose-pine"]);

    for (const name of DARK_THEMES) {
      it(`dark / ${name}: no .token* selector retains background or backgroundColor`, () => {
        const style = getSyntaxTheme("dark", name) as Record<string, Record<string, unknown>>;
        const selectors = tokenSelectors(style);
        if (TOKEN_BEARING.has(name)) {
          expect(selectors.length).toBeGreaterThan(0);
        }
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
        if (TOKEN_BEARING.has(name)) {
          expect(selectors.length).toBeGreaterThan(0);
        }
        for (const sel of selectors) {
          expect(style[sel]).not.toHaveProperty("background");
          expect(style[sel]).not.toHaveProperty("backgroundColor");
        }
      });
    }
  });

  it("preserves the outer pre wrapper background on pre[class*='language-']", () => {
    const style = getSyntaxTheme("dark", "base") as Record<string, Record<string, unknown>>;
    const wrapperKey = Object.keys(style).find((k) => k.startsWith("pre[class*=") && !k.includes(".token"));
    expect(wrapperKey).toBeDefined();
    const wrapper = style[wrapperKey!];
    // The outer pre wrapper is the safety-net default and SHALL remain.
    const hasBg = "background" in wrapper || "backgroundColor" in wrapper;
    expect(hasBg).toBe(true);
  });

  it("strips the inner code wrapper background on code[class*='language-']", () => {
    // Without this strip, the inner <code> paints the prism palette's stock
    // panel color over customStyle.background on the outer PreTag.
    for (const name of DARK_THEMES) {
      const style = getSyntaxTheme("dark", name) as Record<string, Record<string, unknown>>;
      const inner = style['code[class*="language-"]'];
      if (inner) {
        expect(inner).not.toHaveProperty("background");
        expect(inner).not.toHaveProperty("backgroundColor");
      }
    }
    for (const name of LIGHT_THEMES) {
      const style = getSyntaxTheme("light", name) as Record<string, Record<string, unknown>>;
      const inner = style['code[class*="language-"]'];
      if (inner) {
        expect(inner).not.toHaveProperty("background");
        expect(inner).not.toHaveProperty("backgroundColor");
      }
    }
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
