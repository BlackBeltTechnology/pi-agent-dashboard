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
  function tokenIn(blockIdx: number, name: string): string | null {
    const close = css.indexOf("\n}", blockIdx);
    const block = css.slice(blockIdx, close);
    return new RegExp(`${name}:\\s*([^;]+?)\\s*(?:;|$)`).exec(block)?.[1].trim() ?? null;
  }
  const scopes = { dark: css.indexOf(":root {"), light: css.indexOf('[data-theme="light"]') };
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
