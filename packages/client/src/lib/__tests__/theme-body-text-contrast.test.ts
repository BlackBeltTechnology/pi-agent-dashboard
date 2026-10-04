/**
 * Body-text contrast floor for every palette (9 themes × dark/light = 18).
 *
 * `--text-secondary` and `--text-tertiary` carry 10–11 px body text in the
 * session card, so the AA-large 3:1 allowance does NOT apply: both must reach
 * WCAG 2.1 AA 4.5:1 against BOTH `--bg-tertiary` (cards, inputs) and
 * `--bg-surface` (badges, buttons).
 *
 * See change: stop-discarding-known-session-state (tasks 6.1, 6.2, 6.7).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTheme, THEMES } from "../theme/themes.js";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG 2.1 contrast ratio between two opaque #rrggbb colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue (0–1) and saturation (0–1) of a #rrggbb colour — identity fingerprint. */
function hueSat(hex: string): { h: number; s: number } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return { h, s };
}

const MODES = ["dark", "light"] as const;
const TEXT_TOKENS = ["--text-secondary", "--text-tertiary"] as const;
const BACKGROUNDS = ["--bg-tertiary", "--bg-surface"] as const;
const AA = 4.5;

/** All 18 palettes, flattened: [`${themeId}:${mode}`, token map]. */
const PALETTES = THEMES.flatMap((theme) =>
  MODES.map((mode) => [`${theme.id}:${mode}`, theme[mode]] as const),
);

const ACCENT_HUES = ["purple", "blue", "green", "orange", "red", "yellow"] as const;
/** CIE76 ΔE below which two accent-text hues count as hard to tell apart (D4). */
const DELTA_E_MIN = 8;

// ── Palette resolver (color-mix / var) ──────────────────────────────────────
// Lifted to module scope so the ring-contrast suite and the card-fill suite
// share ONE resolver rather than each growing its own copy.
// See change: consolidate-flow-agent-cards (E12).
const CSS_SCOPES = { dark: css.indexOf(":root {"), light: css.indexOf('[data-theme="light"]') };

function cssToken(mode: (typeof MODES)[number], name: string): string | undefined {
  for (const m of [mode, "dark"] as const) {
    const start = CSS_SCOPES[m];
    const block = css.slice(start, css.indexOf("\n}", start));
    const hit = new RegExp(`\\s${name}:\\s*([^;]+?)\\s*;`).exec(block)?.[1].trim();
    if (hit) return hit;
  }
  return undefined;
}

const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function resolveValue(vars: Record<string, unknown>, mode: (typeof MODES)[number], raw: string, depth: number): string {
  const v = raw.trim();
  if (depth > 8) return v;
  const alias = /^var\((--[\w-]+)\)$/.exec(v);
  if (alias) return resolveToken(vars, mode, alias[1], depth + 1);
  // `color-mix(in srgb, A, B)` with no percentage is a 50/50 mix.
  const mix = /^color-mix\(in srgb,\s*(.+?)(?:\s+(\d+)%)?,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = rgb(resolveValue(vars, mode, mix[1], depth + 1));
    const b = rgb(resolveValue(vars, mode, mix[3], depth + 1));
    const p = (mix[2] ? Number(mix[2]) : 50) / 100;
    return toHex(a.map((x, i) => x * p + b[i] * (1 - p)));
  }
  return v;
}

function resolveToken(vars: Record<string, unknown>, mode: (typeof MODES)[number], name: string, depth = 0): string {
  return resolveValue(vars, mode, (vars[name] as string | undefined) ?? cssToken(mode, name) ?? "", depth);
}

/**
 * One scope block of index.css, read with NO fallback to `:root`: a token
 * missing from `[data-theme="light"]` returns null rather than the dark value.
 */
function tokenIn(blockIdx: number, name: string): string | null {
  const close = css.indexOf("\n}", blockIdx);
  const block = css.slice(blockIdx, close);
  return new RegExp(`${name}:\\s*([^;]+?)\\s*(?:;|$)`).exec(block)?.[1].trim() ?? null;
}

/**
 * Hue is derived from the gap between the max and min channel. When that gap
 * is only a few 8-bit steps (a near-neutral colour), one step of rounding
 * moves hue by ~1/6 of that step count, so a fixed 0.02 tolerance is finer
 * than the encoding can resolve. Widen the tolerance to one 8-bit step there.
 */
function hueTolerance(hex: string): number {
  const ch = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const steps = Math.max(...ch) - Math.min(...ch);
  return steps === 0 ? 1 : Math.max(0.02, 1 / 6 / steps);
}

/** AA (4.5:1) assertion; the failure message carries the ratio to 2 dp. */
function expectAA(label: string, fg: string, bg: string): void {
  const ratio = contrast(fg, bg);
  expect(ratio, `${label} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
}

/**
 * Lightness-only fidelity: `after` keeps the hue (within `hueTolerance`) and at
 * least 85 % of the saturation of `before`. An unsaturated `before` has no
 * meaningful hue, so only a colour-cast check applies.
 */
function expectPreserved(label: string, before: string, after: string): void {
  const b = hueSat(before);
  const a = hueSat(after);
  if (b.s > 0.02) {
    const d = Math.abs(b.h - a.h);
    expect(Math.min(d, 1 - d), `${label} hue drifted`).toBeLessThanOrEqual(hueTolerance(after));
    expect(a.s, `${label} collapsed toward neutral grey`).toBeGreaterThanOrEqual(b.s * 0.85);
  } else {
    expect(a.s, `${label} gained a colour cast`).toBeLessThanOrEqual(0.05);
  }
}

/** CIELAB (D65) of a #rrggbb colour: sRGB → linear → XYZ → Lab. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Smallest pairwise CIE76 ΔE between a palette's six accent-text values. */
function minDeltaE(text: Record<string, string>): { min: number; pair: string } {
  let min = Number.POSITIVE_INFINITY;
  let pair = "";
  for (let i = 0; i < ACCENT_HUES.length; i++) {
    for (let j = i + 1; j < ACCENT_HUES.length; j++) {
      const [p, q] = [lab(text[ACCENT_HUES[i]]), lab(text[ACCENT_HUES[j]])];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < min) [min, pair] = [d, `${ACCENT_HUES[i]}/${ACCENT_HUES[j]}`];
    }
  }
  return { min, pair };
}

/**
 * Hue-distinction check (design D4). A palette in `known` must stay BELOW the
 * threshold (else the entry is stale); every other palette must reach it.
 */
function expectDistinction(name: string, text: Record<string, string>, known: readonly string[]): void {
  const { min, pair } = minDeltaE(text);
  if (known.includes(name)) {
    expect(
      min,
      `${name} is listed but its closest pair ${pair} has ΔE ${min.toFixed(1)} ≥ ${DELTA_E_MIN}; remove from KNOWN_INDISTINGUISHABLE`,
    ).toBeLessThan(DELTA_E_MIN);
  } else {
    expect(
      min,
      `${name} accent-text ${pair} are hard to tell apart (ΔE ${min.toFixed(1)} < ${DELTA_E_MIN})`,
    ).toBeGreaterThanOrEqual(DELTA_E_MIN);
  }
}

describe("body-text contrast floor (WCAG AA 4.5:1) — all 18 palettes", () => {
  for (const [name, vars] of PALETTES) {
    for (const token of TEXT_TOKENS) {
      for (const bg of BACKGROUNDS) {
        it(`${name} ${token} on ${bg}`, () => {
          const ratio = contrast(vars[token] as string, vars[bg] as string);
          expect(
            ratio,
            `${name} ${token} ${vars[token]} on ${bg} ${vars[bg]} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA);
        });
      }
    }
  }
});

describe("text hierarchy survives remediation", () => {
  for (const [name, vars] of PALETTES) {
    for (const bg of BACKGROUNDS) {
      it(`${name}: --text-secondary is at least as legible as --text-tertiary on ${bg}`, () => {
        const secondary = contrast(vars["--text-secondary"] as string, vars[bg] as string);
        const tertiary = contrast(vars["--text-tertiary"] as string, vars[bg] as string);
        expect(
          secondary,
          `${name} on ${bg}: secondary ${secondary.toFixed(2)}:1 < tertiary ${tertiary.toFixed(2)}:1 — the token meant to recede is the most legible`,
        ).toBeGreaterThanOrEqual(tertiary);
      });
    }
  }
});

// The Base theme is the one palette that is duplicated in index.css (:root and
// [data-theme="light"]); every remediated value must land in both sources or
// they drift silently.
describe("themes.ts / index.css parity for the Base palette", () => {
  const scopes = CSS_SCOPES;
  const base = getTheme("base");

  for (const mode of MODES) {
    for (const token of [...TEXT_TOKENS, ...BACKGROUNDS]) {
      it(`${mode} ${token} matches themes.ts`, () => {
        expect(base).toBeDefined();
        expect(tokenIn(scopes[mode], token)).toBe((base as NonNullable<typeof base>)[mode][token]);
      });
    }
  }
});

// Fidelity rule: a remediated token adjusts lightness only. A value whose hue
// drifted, or that collapsed to a neutral grey, has lost the theme's identity.
describe("remediation preserves hue and saturation", () => {
  /** Upstream values as published, before the AA remediation. */
  const ORIGINAL: Record<string, Record<string, string>> = {
    "base:dark": { "--text-tertiary": "#808080", "--text-secondary": "#b0b0b0" },
    "base:light": { "--text-tertiary": "#777777", "--text-secondary": "#444444" },
    "dracula:dark": { "--text-tertiary": "#6272a4", "--text-secondary": "#ccc9e7" },
    "dracula:light": { "--text-tertiary": "#6272a4", "--text-secondary": "#44475a" },
    "nord:dark": { "--text-tertiary": "#81899b", "--text-secondary": "#d8dee9" },
    "nord:light": { "--text-tertiary": "#636e83", "--text-secondary": "#3b4252" },
    "github:dark": { "--text-tertiary": "#8b949e", "--text-secondary": "#c9d1d9" },
    "github:light": { "--text-tertiary": "#656d76", "--text-secondary": "#424a53" },
    "catppuccin:dark": { "--text-tertiary": "#7f849c", "--text-secondary": "#bac2de" },
    "catppuccin:light": { "--text-tertiary": "#7c7f93", "--text-secondary": "#5c5f77" },
    "tokyo-night:dark": { "--text-tertiary": "#787c99", "--text-secondary": "#a9b1d6" },
    "tokyo-night:light": { "--text-tertiary": "#6172b0", "--text-secondary": "#343b59" },
    "rose-pine:dark": { "--text-tertiary": "#908caa", "--text-secondary": "#cdcbe0" },
    "rose-pine:light": { "--text-tertiary": "#9893a5", "--text-secondary": "#797593" },
    "solarized:dark": { "--text-tertiary": "#839496", "--text-secondary": "#93a1a1" },
    "solarized:light": { "--text-tertiary": "#657b83", "--text-secondary": "#586e75" },
    "gruvbox:dark": { "--text-tertiary": "#a89984", "--text-secondary": "#d5c4a1" },
    "gruvbox:light": { "--text-tertiary": "#7c6f64", "--text-secondary": "#504945" },
  };

  it("covers every palette (the table cannot silently miss one)", () => {
    expect(Object.keys(ORIGINAL).sort()).toEqual(PALETTES.map(([n]) => n).sort());
  });

  for (const [name, vars] of PALETTES) {
    for (const token of TEXT_TOKENS) {
      it(`${name} ${token} keeps its hue and saturation`, () => {
        const before = hueSat(ORIGINAL[name][token]);
        const after = hueSat(vars[token] as string);
        // Hue is circular; compare the shorter arc. Unsaturated originals have
        // no meaningful hue, so only the saturation check applies there.
        if (before.s > 0.02) {
          const d = Math.abs(before.h - after.h);
          expect(Math.min(d, 1 - d), `${name} ${token} hue drifted`).toBeLessThanOrEqual(
            hueTolerance(vars[token] as string),
          );
          expect(after.s, `${name} ${token} collapsed toward neutral grey`).toBeGreaterThanOrEqual(
            before.s * 0.85,
          );
        } else {
          expect(after.s, `${name} ${token} gained a colour cast`).toBeLessThanOrEqual(0.05);
        }
      });
    }
  }
});

// History-load ring tokens (non-text UI component, WCAG 1.4.11: 3:1) against
// every backdrop the ring paints on: the unselected card (`--bg-primary`), the
// chip / selected-card base (`--bg-tertiary`) and the selected card itself
// (`--tint-blue-bg`, a color-mix). A token a palette does not override falls
// back to index.css for its mode (then `:root`); `var()` and `color-mix(in
// srgb …)` resolve through the palette first.
// See change: show-session-history-load-state (test-plan #E6).
describe("history-load ring contrast (WCAG 1.4.11 3:1) — all 18 palettes", () => {
  const RING_TOKENS = ["--accent-text", "--text-tertiary", "--tint-red-fg"] as const;
  const CARD_BGS = ["--bg-primary", "--bg-tertiary", "--tint-blue-bg"] as const;
  for (const [name, vars] of PALETTES) {
    const mode = name.endsWith(":light") ? "light" : "dark";
    for (const token of RING_TOKENS) {
      for (const bg of CARD_BGS) {
        it(`${name} ${token} on ${bg}`, () => {
          const fg = resolveToken(vars, mode, token);
          const back = resolveToken(vars, mode, bg);
          expect(fg, `${name} ${token} must resolve to #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
          expect(back, `${name} ${bg} must resolve to #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
          const ratio = contrast(fg, back);
          expect(ratio, `${name} ${token} ${fg} on ${bg} ${back} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

// The card's UNSELECTED fill is `color-mix(in srgb, var(--bg-secondary),
// var(--bg-tertiary))` (AgentCardShell). Card secondary text (stats line,
// basename line, tool-call lines, branch/failure annotations) must clear AA on
// THAT fill, not only on --bg-tertiary / --bg-surface. --text-tertiary clears
// it; --text-muted does not, so a silent token swap fails the guard.
// See change: consolidate-flow-agent-cards (E12).
describe("card-fill body-text contrast (WCAG AA 4.5:1) — all 18 palettes", () => {
  const CARD_FILL = "color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))";
  for (const [name, vars] of PALETTES) {
    const mode = name.endsWith(":light") ? "light" : "dark";
    const fill = resolveValue(vars, mode, CARD_FILL, 0);
    it(`${name} --text-tertiary on the card fill`, () => {
      const fg = resolveToken(vars, mode, "--text-tertiary");
      expect(fg, `${name} --text-tertiary must resolve to #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(fill, `${name} card fill must resolve to #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
      const ratio = contrast(fg, fill);
      expect(
        ratio,
        `${name} --text-tertiary ${fg} on card fill ${fill} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA);
    });
    it(`${name} --text-muted is below AA on the card fill (token-swap guard)`, () => {
      const fg = resolveToken(vars, mode, "--text-muted");
      const ratio = contrast(fg, fill);
      expect(
        ratio,
        `${name} --text-muted ${fg} on card fill ${fill} = ${ratio.toFixed(2)}:1 must be below AA`,
      ).toBeLessThan(AA);
    });
  }
});

// ── On-surface accent-text ramp ─────────────────────────────────────────────
// `--accent-<hue>-text` is the coloured-TEXT role of each accent: it must reach
// WCAG AA 4.5:1 on every backdrop text sits on (surface, tertiary, primary, the
// card fill), stay the same hue as its `--accent-<hue>` fill (lightness-only),
// and equal the fill byte-for-byte when the fill already passes. Values come
// from `openspec/changes/archive/*-remediate-accent-text-contrast/derive-accent-text.ts`.
// See change: remediate-accent-text-contrast.
describe("accent-text ramp — on-surface AA, fidelity, distinction", () => {
  const CARD_FILL = "color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))";
  const TEXT_BACKDROPS = ["--bg-surface", "--bg-tertiary", "--bg-primary", "card fill"] as const;
  /**
   * Palettes whose accent-text hues are knowingly hard to tell apart. The spec
   * "Accent-text hue is a secondary cue" (theme-gallery) makes every adopting
   * surface back hue with a word, icon or shape, so this is recorded, not hidden.
   */
  const KNOWN_INDISTINGUISHABLE = ["solarized:dark"] as const;

  function backdrops(name: string, vars: Record<string, unknown>): Record<string, string> {
    const mode = name.endsWith(":light") ? "light" : "dark";
    return {
      "--bg-surface": resolveToken(vars, mode, "--bg-surface"),
      "--bg-tertiary": resolveToken(vars, mode, "--bg-tertiary"),
      "--bg-primary": resolveToken(vars, mode, "--bg-primary"),
      "card fill": resolveValue(vars, mode, CARD_FILL, 0),
    };
  }
  const textOf = (vars: Record<string, unknown>) =>
    Object.fromEntries(ACCENT_HUES.map((h) => [h, vars[`--accent-${h}-text`] as string]));

  for (const [name, vars] of PALETTES) {
    const bgs = backdrops(name, vars);
    for (const hue of ACCENT_HUES) {
      const token = `--accent-${hue}-text`;
      it(`${name} ${token} is a #rrggbb literal`, () => {
        expect(vars[token], `${name} ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      });
      for (const bg of TEXT_BACKDROPS) {
        it(`${name} ${token} on ${bg} ≥ 4.5:1`, () => {
          expect(vars[token], `${name} ${token} missing`).toBeDefined();
          expectAA(`${name} ${token} on ${bg}`, vars[token] as string, bgs[bg]);
        });
      }
      it(`${name} ${token} keeps the hue and saturation of --accent-${hue}`, () => {
        expect(vars[token], `${name} ${token} missing`).toBeDefined();
        expectPreserved(`${name} ${token}`, vars[`--accent-${hue}`] as string, vars[token] as string);
      });
    }
    it(`${name} accent-text hue distinction (ΔE ${DELTA_E_MIN})`, () => {
      expectDistinction(name, textOf(vars), KNOWN_INDISTINGUISHABLE);
    });
  }

  it("a source accent that already passes every backdrop is adopted unchanged (exactly 28 cells)", () => {
    let passing = 0;
    for (const [name, vars] of PALETTES) {
      const bgs = Object.values(backdrops(name, vars));
      for (const hue of ACCENT_HUES) {
        const src = vars[`--accent-${hue}`] as string;
        if (Math.min(...bgs.map((b) => contrast(src, b))) < AA) continue;
        passing++;
        expect(vars[`--accent-${hue}-text`], `${name} --accent-${hue}-text must equal the passing source`).toBe(src);
      }
    }
    expect(passing).toBe(28);
  });

  it("Base dark purple is legible on --bg-surface (source #a855f7 is 3.63:1)", () => {
    const base = getTheme("base") as NonNullable<ReturnType<typeof getTheme>>;
    expect(base.dark["--bg-surface"]).toBe("#2a2a2a");
    expectAA("base:dark --accent-purple-text", base.dark["--accent-purple-text"], "#2a2a2a");
  });

  describe("Base palette parity with index.css", () => {
    const base = getTheme("base") as NonNullable<ReturnType<typeof getTheme>>;
    for (const mode of MODES) {
      for (const hue of ACCENT_HUES) {
        it(`${mode} --accent-${hue}-text is declared explicitly in its own block and matches themes.ts`, () => {
          expect(tokenIn(CSS_SCOPES[mode], `--accent-${hue}-text`)).toBe(base[mode][`--accent-${hue}-text`]);
        });
      }
    }
    for (const hue of ACCENT_HUES) {
      it(`:root --accent-${hue} equals baseDark and baseLight (Base light inherits it)`, () => {
        const root = tokenIn(CSS_SCOPES.dark, `--accent-${hue}`);
        expect(root).toBe(base.dark[`--accent-${hue}`]);
        expect(root).toBe(base.light[`--accent-${hue}`]);
      });
    }
  });

  describe("helpers reject what they must (fixtures)", () => {
    it("the AA floor is ≥ 4.5, not a rounded 4.4: a 4.49:1 pair fails", () => {
      expect(contrast("#767680", "#ffffff").toFixed(2)).toBe("4.49");
      expect(() => expectAA("fixture --accent-x-text", "#767680", "#ffffff")).toThrow(/4\.49:1/);
    });

    it("a -text collapsed to grey fails the fidelity check", () => {
      expect(() => expectPreserved("fixture --accent-purple-text", "#a855f7", "#9a9a9a")).toThrow(
        /collapsed toward neutral grey/,
      );
    });

    const wellSeparated = {
      purple: "#a855f7",
      blue: "#3b82f6",
      green: "#22c55e",
      orange: "#f97316",
      red: "#ef4444",
      yellow: "#eab308",
    };

    it("a listed palette with well-separated hues is a stale entry", () => {
      expect(() => expectDistinction("fixture:dark", wellSeparated, ["fixture:dark"])).toThrow(
        /remove from KNOWN_INDISTINGUISHABLE/,
      );
    });

    it("an unlisted palette with an orange/red collision is named", () => {
      const collided = { ...wellSeparated, orange: "#fce8df", red: "#fbe7e6" };
      expect(() => expectDistinction("fixture:dark", collided, [])).toThrow(/fixture:dark.*orange\/red/);
    });
  });
});
