import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSS_VAR_KEYS, getTheme, THEMES } from "../theme/themes.js";

// index.css lives two dirs up from this __tests__ folder (src/lib/__tests__ -> src).
const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");

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
        expect(vars["--status-notice"], `${theme.id} ${mode}`).toBe("var(--accent-blue)");
      }
    }
  });

  it("every theme defines --table-stripe in both modes", () => {
    for (const theme of THEMES) {
      expect(theme.dark["--table-stripe"], `${theme.id} dark`).toBeDefined();
      expect(theme.light["--table-stripe"], `${theme.id} light`).toBeDefined();
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

// --elevation-rim lives in index.css (per-mode, theme-agnostic) rather than in
// the theme maps, so it survives applyThemeVars (which only touches
// CSS_VAR_KEYS). See change: add-panel-elevation-system.
describe("--elevation-rim panel-bevel token", () => {
  it("declares the dark value (default / :root)", () => {
    expect(css).toContain("--elevation-rim: rgba(255, 255, 255, 0.10);");
  });

  it("declares the light-mode override value", () => {
    expect(css).toContain("--elevation-rim: rgba(255, 255, 255, 0.9);");
  });

  it("places the dark value before the [data-theme=\"light\"] override (per-mode cascade)", () => {
    const darkIdx = css.indexOf("--elevation-rim: rgba(255, 255, 255, 0.10);");
    const lightBlockIdx = css.indexOf('[data-theme="light"]');
    const lightValIdx = css.indexOf("--elevation-rim: rgba(255, 255, 255, 0.9);");
    expect(darkIdx).toBeGreaterThanOrEqual(0);
    expect(lightBlockIdx).toBeGreaterThanOrEqual(0);
    expect(darkIdx).toBeLessThan(lightBlockIdx);
    expect(lightValIdx).toBeGreaterThan(lightBlockIdx);
  });

  it("is theme-independent (not in CSS_VAR_KEYS, so named themes never override it)", () => {
    expect(CSS_VAR_KEYS).not.toContain("--elevation-rim");
  });
});

// --table-stripe is a registered theme token (in CSS_VAR_KEYS) AND declared in
// index.css :root / [data-theme="light"] so the `base` theme (inline vars
// stripped) still resolves it. See change: markdown-table-styling.
describe("--table-stripe token", () => {
  it("is registered in CSS_VAR_KEYS", () => {
    expect(CSS_VAR_KEYS).toContain("--table-stripe");
  });

  it("declares the dark value in :root and the light override", () => {
    expect(css).toContain("--table-stripe: rgba(255, 255, 255, 0.045);");
    expect(css).toContain("--table-stripe: rgba(0, 0, 0, 0.035);");
  });
});

// --border-strong exists solely to give an overlay surface a boundary that
// meets WCAG 2.1 SC 1.4.11 (3:1) against the transcript background. Defined in
// BOTH index.css theme blocks: a token present in only one falls back to an
// invalid value and the border silently disappears in the other theme.
// See change: fix-replay-pill-a11y-and-collision.
describe("--border-strong overlay-boundary token", () => {
  /** WCAG relative luminance of a #rrggbb colour. */
  function luminance(hex: string): number {
    const ch = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** Value of `name` inside the block starting at `blockIdx`, read from index.css. */
  function tokenIn(blockIdx: number, name: string): string | null {
    const close = css.indexOf("\n}", blockIdx);
    const block = css.slice(blockIdx, close);
    return new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1].trim() ?? null;
  }

  const rootIdx = css.indexOf(":root {");
  const lightIdx = css.indexOf('[data-theme="light"]');

  it("is declared in the :root (dark) block", () => {
    expect(tokenIn(rootIdx, "--border-strong")).toBe("#808080");
  });

  it("is declared in the [data-theme=\"light\"] block", () => {
    expect(tokenIn(lightIdx, "--border-strong")).toBe("#777777");
  });

  it("clears the SC 1.4.11 3:1 floor against --bg-primary in the dark theme", () => {
    const border = tokenIn(rootIdx, "--border-strong");
    const bg = tokenIn(rootIdx, "--bg-primary");
    expect(contrast(border as string, bg as string)).toBeGreaterThanOrEqual(3);
  });

  it("clears the SC 1.4.11 3:1 floor against --bg-primary in the light theme", () => {
    const border = tokenIn(lightIdx, "--border-strong");
    const bg = tokenIn(lightIdx, "--bg-primary");
    expect(contrast(border as string, bg as string)).toBeGreaterThanOrEqual(3);
  });
});

// The replay-in-flight indicator must stop animating under
// `prefers-reduced-motion: reduce` while staying rendered. Scoped through the
// label's data-testid because the spinner is a Tailwind utility on an <Icon>
// SVG, not a stable authored class.
// See change: fix-replay-pill-a11y-and-collision.
describe("replay-in-flight indicator reduced-motion rule", () => {
  const idx = css.indexOf('[data-testid="replay-in-flight-pill"] .animate-spin');

  it("declares a reduced-motion rule scoped to the indicator", () => {
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("sits inside a prefers-reduced-motion: reduce block and zeroes the animation", () => {
    const block = css.lastIndexOf("@media (prefers-reduced-motion: reduce)", idx);
    expect(block).toBeGreaterThanOrEqual(0);
    expect(css.slice(idx, css.indexOf("}", idx))).toContain("animation: none");
  });

  it("does not hide the indicator (reducing motion must not remove the status)", () => {
    const rule = css.slice(idx, css.indexOf("}", idx));
    expect(rule).not.toContain("display: none");
    expect(rule).not.toContain("visibility: hidden");
  });
});
