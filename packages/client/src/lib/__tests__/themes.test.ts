import { describe, it, expect } from "vitest";
import { THEMES, CSS_VAR_KEYS, getTheme } from "../themes.js";

describe("themes", () => {
  it("has 9 themes", () => {
    expect(THEMES.length).toBe(9);
  });

  it("all themes define all CSS variable keys (dark)", () => {
    for (const theme of THEMES) {
      for (const key of CSS_VAR_KEYS) {
        expect(theme.dark[key], `${theme.id} dark missing ${key}`).toBeDefined();
      }
    }
  });

  it("all themes define all CSS variable keys (light)", () => {
    for (const theme of THEMES) {
      for (const key of CSS_VAR_KEYS) {
        expect(theme.light[key], `${theme.id} light missing ${key}`).toBeDefined();
      }
    }
  });

  it("Base dark matches known CSS root values", () => {
    const base = getTheme("base")!;
    expect(base.dark["--bg-primary"]).toBe("#0a0a0a");
    expect(base.dark["--text-primary"]).toBe("#e5e5e5");
    expect(base.dark["--accent-blue"]).toBe("#3b82f6");
  });

  it("Base light matches known CSS light values", () => {
    const base = getTheme("base")!;
    expect(base.light["--bg-primary"]).toBe("#ffffff");
    expect(base.light["--text-primary"]).toBe("#1a1a1a");
  });

  it("every theme defines the semantic status tokens, derived from its accents", () => {
    for (const theme of THEMES) {
      for (const mode of ["dark", "light"] as const) {
        const vars = theme[mode];
        expect(vars["--status-needs-you"], `${theme.id} ${mode}`).toBe("var(--accent-purple)");
        expect(vars["--status-working"], `${theme.id} ${mode}`).toBe("var(--accent-yellow)");
        expect(vars["--status-idle"], `${theme.id} ${mode}`).toBe("var(--accent-green)");
        expect(vars["--status-error"], `${theme.id} ${mode}`).toBe("var(--accent-red)");
      }
    }
  });

  it("getTheme returns undefined for unknown id", () => {
    expect(getTheme("nonexistent")).toBeUndefined();
  });

  it("each theme has unique id", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each theme has syntaxDark and syntaxLight", () => {
    for (const theme of THEMES) {
      expect(theme.syntaxDark).toBeTruthy();
      expect(theme.syntaxLight).toBeTruthy();
    }
  });
});
