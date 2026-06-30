import { describe, it, expect } from "vitest";
import { buildMonacoTheme } from "../monaco-theme.js";
import { THEMES, getTheme } from "../themes.js";

const MODES = ["light", "dark"] as const;

describe("buildMonacoTheme", () => {
  it("matches base polarity to the resolved mode for every theme × mode", () => {
    for (const theme of THEMES) {
      for (const mode of MODES) {
        const built = buildMonacoTheme(theme.id, mode);
        expect(built.data.base, `${theme.id}/${mode}`).toBe(mode === "dark" ? "vs-dark" : "vs");
      }
    }
  });

  it("maps editor.background to the theme's --bg-code", () => {
    for (const theme of THEMES) {
      for (const mode of MODES) {
        const tokens = mode === "light" ? theme.light : theme.dark;
        const built = buildMonacoTheme(theme.id, mode);
        expect(built.data.colors["editor.background"], `${theme.id}/${mode}`).toBe(tokens["--bg-code"]);
      }
    }
  });

  it("maps editor.foreground to the theme's --text-primary", () => {
    for (const theme of THEMES) {
      for (const mode of MODES) {
        const tokens = mode === "light" ? theme.light : theme.dark;
        const built = buildMonacoTheme(theme.id, mode);
        expect(built.data.colors["editor.foreground"], `${theme.id}/${mode}`).toBe(tokens["--text-primary"]);
      }
    }
  });

  it("colors the keyword rule with the theme's --accent-purple (hex sans #)", () => {
    const theme = getTheme("dracula")!;
    const built = buildMonacoTheme("dracula", "dark");
    const keyword = built.data.rules.find((r) => r.token === "keyword");
    expect(keyword?.foreground).toBe(theme.dark["--accent-purple"].slice(1));
  });

  it("produces a stable, deterministic name and identical data on repeat calls", () => {
    const a = buildMonacoTheme("nord", "dark");
    const b = buildMonacoTheme("nord", "dark");
    expect(a.name).toBe("pi-monaco-nord-dark");
    expect(a).toEqual(b);
  });

  it("falls back to base for an unknown theme id", () => {
    const unknown = buildMonacoTheme("does-not-exist", "dark");
    const base = buildMonacoTheme("base", "dark");
    expect(unknown.data.colors["editor.background"]).toBe(base.data.colors["editor.background"]);
  });

  it("never leaks var(...) or rgba strings into Monaco colors", () => {
    for (const theme of THEMES) {
      for (const mode of MODES) {
        const built = buildMonacoTheme(theme.id, mode);
        for (const [key, value] of Object.entries(built.data.colors)) {
          expect(value, `${theme.id}/${mode} ${key}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
        }
      }
    }
  });

  it("emits token-rule foregrounds as bare hex (no leading #)", () => {
    const built = buildMonacoTheme("base", "dark");
    for (const rule of built.data.rules) {
      expect(rule.foreground).toMatch(/^[0-9a-fA-F]{3,8}$/);
    }
  });
});
