/**
 * Worktree-init body copy (`--text-secondary`) clears AA (4.5:1) on the info and
 * error banner backgrounds in every palette (9 themes × dark/light + base).
 * See change: fix-worktree-init-chip-overflow (test-plan #E5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "../theme/themes.js";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");
type Mode = "dark" | "light";
const SCOPES = { dark: css.indexOf(":root {"), light: css.indexOf('[data-theme="light"]') };

function cssToken(mode: Mode, name: string): string | undefined {
  for (const m of [mode, "dark"] as const) {
    const start = SCOPES[m];
    const block = css.slice(start, css.indexOf("\n}", start));
    const hit = new RegExp(`\\s${name}:\\s*([^;]+?)\\s*;`).exec(block)?.[1].trim();
    if (hit) return hit;
  }
  return undefined;
}

const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function resolveValue(vars: Record<string, unknown>, mode: Mode, raw: string, depth: number): string {
  const v = raw.trim();
  if (depth > 8) return v;
  const alias = /^var\((--[\w-]+)\)$/.exec(v);
  if (alias) return resolveToken(vars, mode, alias[1], depth + 1);
  const mix = /^color-mix\(in srgb,\s*(.+?)(?:\s+(\d+)%)?,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = rgb(resolveValue(vars, mode, mix[1], depth + 1));
    const b = rgb(resolveValue(vars, mode, mix[3], depth + 1));
    const p = (mix[2] ? Number(mix[2]) : 50) / 100;
    return toHex(a.map((x, i) => x * p + b[i] * (1 - p)));
  }
  return v;
}

function resolveToken(vars: Record<string, unknown>, mode: Mode, name: string, depth = 0): string {
  return resolveValue(vars, mode, (vars[name] as string | undefined) ?? cssToken(mode, name) ?? "", depth);
}

function luminance(hex: string): number {
  const ch = rgb(hex).map((x) => {
    const c = x / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTES: Array<[string, Mode, Record<string, unknown>]> = [
  ["base:dark", "dark", {}],
  ["base:light", "light", {}],
  ...THEMES.flatMap((t) => (["dark", "light"] as const).map((m) => [`${t.id}:${m}`, m, t[m] as Record<string, unknown>] as [string, Mode, Record<string, unknown>])),
];

const FLOOR = 4.5;
const SEVERITIES = ["--severity-info-bg", "--severity-error-bg"] as const;

/** Failing cells for one palette (empty = pass); each names severity + ratio. */
function failures(vars: Record<string, unknown>, mode: Mode): string[] {
  const t = (n: string) => resolveToken(vars, mode, n);
  const fg = t("--text-secondary");
  const out: string[] = [];
  for (const sev of SEVERITIES) {
    const r = contrast(fg, t(sev));
    if (!(r >= FLOOR)) out.push(`--text-secondary on ${sev} ${r.toFixed(2)} < ${FLOOR}`);
  }
  return out;
}

describe("worktree-init body copy contrast (E5)", () => {
  it.each(PALETTES)("%s: --text-secondary clears AA on info and error banners", (_name, mode, vars) => {
    expect(failures(vars, mode)).toEqual([]);
  });

  it("covers every palette × severity cell (at least the 36 of the original 18 palettes)", () => {
    expect(PALETTES.length * SEVERITIES.length).toBeGreaterThanOrEqual(36);
  });

  it("the assertion bites: a low-contrast fixture fails and names the cell", () => {
    const bad = { "--text-secondary": "#c8c8d0", "--severity-info-bg": "#e1e2e7", "--severity-error-bg": "#e1e2e7" };
    const out = failures(bad, "light");
    expect(out.length).toBe(2);
    expect(out[0]).toMatch(/--severity-info-bg \d+\.\d+ < 4\.5/);
  });
});
