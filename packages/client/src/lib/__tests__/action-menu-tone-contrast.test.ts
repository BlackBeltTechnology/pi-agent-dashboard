/**
 * Contrast floors for the action-menu tone colours across every palette
 * (9 themes × dark/light + base). See change: colorize-actions-menus (test-plan #E25).
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

/** Returns the failing assertions for one palette (empty = pass). */
function failures(vars: Record<string, unknown>, mode: Mode): string[] {
  const t = (n: string) => resolveToken(vars, mode, n);
  const bg = t("--bg-secondary");
  const redBg = t("--tint-red-bg");
  const out: string[] = [];
  const need = (label: string, fg: string, on: string, min: number) => {
    const r = contrast(fg, on);
    if (!(r >= min)) out.push(`${label} ${r.toFixed(2)} < ${min}`);
  };
  for (const hue of ["green", "blue", "orange", "red"]) need(`${hue}-text/bg`, t(`--accent-${hue}-text`), bg, 3);
  need("red-text/red-bg", t("--accent-red-text"), redBg, 4.5);
  need("orange-text/bg", t("--accent-orange-text"), bg, 4.5);
  need("yellow-text/bg", t("--accent-yellow-text"), bg, 3);
  need("text-tertiary/bg", t("--text-tertiary"), bg, 3);
  return out;
}

describe("action-menu tone contrast floors (E25)", () => {
  it.each(PALETTES)("%s meets every floor", (_name, mode, vars) => {
    expect(failures(vars, mode)).toEqual([]);
  });

  it("the assertion bites: a low-contrast fixture fails", () => {
    const bad = { "--bg-secondary": "#e1e2e7", "--accent-green-text": "#8a8a8a", "--accent-blue-text": "#8a8a8a", "--accent-orange-text": "#8a8a8a", "--accent-red-text": "#8a8a8a", "--accent-yellow-text": "#8a8a8a", "--text-tertiary": "#8a8a8a", "--tint-red-bg": "#e1e2e7" };
    expect(failures(bad, "light").length).toBeGreaterThan(0);
  });
});
