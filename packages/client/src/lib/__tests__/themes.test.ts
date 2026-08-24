import { readdirSync, readFileSync, statSync } from "node:fs";
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

// The accent RAMP. `--accent` and `--accent-soft` were referenced by component
// code but declared NOWHERE, so every `var(--accent-soft,#1d3a63)` call site
// painted its dark-navy fallback literal in BOTH themes while the text above it
// stayed theme-aware — 1.52:1 on the light Gateway Setup tab. Each token below
// carries exactly one role and exactly one contrast floor; binding the wrong one
// (notably `--accent` under white text, 3.68:1 in BOTH themes) is the defect
// this suite exists to catch. See change: add-zrok-custom-reserved-name, D8.
describe("accent ramp", () => {
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
  function tokenIn(blockIdx: number, name: string): string | null {
    const close = css.indexOf("\n}", blockIdx);
    const block = css.slice(blockIdx, close);
    return new RegExp(`\\s${name}:\\s*([^;]+);`).exec(block)?.[1].trim() ?? null;
  }

  const scopes = {
    dark: css.indexOf(":root {"),
    light: css.indexOf('[data-theme="light"]'),
  } as const;
  const RAMP = ["--accent", "--accent-soft", "--accent-solid", "--accent-text"] as const;

  // E20 — declared in both scopes.
  for (const [mode, idx] of Object.entries(scopes)) {
    for (const token of RAMP) {
      it(`declares ${token} in the ${mode} scope`, () => {
        expect(tokenIn(idx, token), `${token} missing from ${mode}`).toMatch(/^#[0-9a-f]{6}$/i);
      });
    }
  }

  // E20 — each token meets the floor for the ROLE it serves.
  for (const [mode, idx] of Object.entries(scopes)) {
    it(`--accent-soft carries --text-primary at AA in ${mode}`, () => {
      const ratio = contrast(tokenIn(idx, "--accent-soft") as string, tokenIn(idx, "--text-primary") as string);
      expect(ratio, `${mode} soft/text-primary = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`--accent-solid carries white text at AA in ${mode}`, () => {
      const ratio = contrast(tokenIn(idx, "--accent-solid") as string, "#ffffff");
      expect(ratio, `${mode} solid/white = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`--accent-text is AA on the page background in ${mode}`, () => {
      const ratio = contrast(tokenIn(idx, "--accent-text") as string, tokenIn(idx, "--bg-primary") as string);
      expect(ratio, `${mode} accent-text/bg = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`--accent clears the 3:1 non-text border floor in ${mode}`, () => {
      const ratio = contrast(tokenIn(idx, "--accent") as string, tokenIn(idx, "--bg-primary") as string);
      expect(ratio, `${mode} accent/bg = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }

  // E20 — the inverted affordance that started this: the SELECTED chip was the
  // least readable element on the tab (1.52:1 selected vs 2.23:1 unselected).
  it("the selected chip is no less readable than an unselected one, in both themes", () => {
    for (const [mode, idx] of Object.entries(scopes)) {
      const selected = contrast(tokenIn(idx, "--accent-soft") as string, tokenIn(idx, "--text-primary") as string);
      const unselected = contrast(tokenIn(idx, "--bg-tertiary") as string, tokenIn(idx, "--text-secondary") as string);
      expect(selected, `${mode}: selected ${selected.toFixed(2)} < unselected ${unselected.toFixed(2)}`).toBeGreaterThanOrEqual(unselected);
    }
  });

  // E21 — the survivor. Declaring `--accent: #3b82f6` and merely stripping the
  // inline literal leaves white on it at 3.68:1, which IS the reported defect.
  // Every solid fill under white text must bind `--accent-solid`.
  it("--accent is NOT a valid fill under white text in either theme (why --accent-solid exists)", () => {
    for (const [mode, idx] of Object.entries(scopes)) {
      const asFill = contrast(tokenIn(idx, "--accent") as string, "#ffffff");
      const solid = contrast(tokenIn(idx, "--accent-solid") as string, "#ffffff");
      if (asFill < 4.5) expect(solid, `${mode}: --accent-solid must rescue it`).toBeGreaterThanOrEqual(4.5);
    }
    // dark specifically: this is the theme the naive fix would have shipped broken
    expect(contrast(tokenIn(scopes.dark, "--accent") as string, "#ffffff")).toBeLessThan(4.5);
  });
});

// E21 (source arm) — a contrast number proves nothing if a component still
// binds the wrong token. These scan real component source so a regression at a
// call site fails here rather than in a manual light-mode inspection.
describe("accent ramp call sites", () => {
  const SRC = join(import.meta.dirname, "..", "..", "components");

  function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
      else if (name.endsWith(".tsx")) out.push(full);
    }
    return out;
  }
  const sources = tsxFiles(SRC).map((f) => [f, readFileSync(f, "utf8")] as const);

  it("no component paints a solid --accent background under white text", () => {
    const offenders: string[] = [];
    for (const [file, src] of sources) {
      for (const line of src.split("\n")) {
        if (/bg-\[var\(--accent[,)]/.test(line) && /text-white/.test(line)) {
          offenders.push(`${file.split("/components/")[1]}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders, "bind --accent-solid (5.17:1), not --accent (3.68:1)").toEqual([]);
  });

  it("no Gateway component still carries an inline accent fallback literal", () => {
    const offenders: string[] = [];
    for (const [file, src] of sources) {
      if (!file.includes("/Gateway/")) continue;
      for (const line of src.split("\n")) {
        if (/var\(--accent[a-z-]*,\s*(#|rgb|hsl)/.test(line)) {
          offenders.push(`${file.split("/components/")[1]}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders, "the token is declared now — drop the literal").toEqual([]);
  });

  it("the Gateway does not paint text in the sub-AA --text-muted token", () => {
    const offenders = sources
      .filter(([f, s]) => f.includes("/Gateway/") && s.includes("var(--text-muted)"))
      .map(([f]) => f.split("/components/")[1]);
    expect(offenders, "--text-muted measures 2.04–2.78:1 on every surface").toEqual([]);
  });
});
