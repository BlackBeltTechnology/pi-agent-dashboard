/**
 * Contrast floors for the folder-card slot-pill colour tokens across every
 * palette (9 themes × dark/light + base): glyph chip (non-text, 3:1) and the
 * marker / secondary text floors (4.5:1). Resolver mirrors
 * action-menu-tone-contrast.test.ts.
 * See change: fix-folder-card-pill-contrast (test-plan #E2, #E3).
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

const GLYPH_HUES = ["blue", "green", "purple", "red"] as const;
const MARKER_HUES = ["blue", "green", "purple", "red", "orange", "yellow"] as const;

/** Failing assertions for one palette (empty = pass). Messages name hue + ratio. */
function failures(vars: Record<string, unknown>, mode: Mode, base: boolean): string[] {
  const t = (n: string) => resolveToken(vars, mode, n);
  const out: string[] = [];
  const need = (label: string, fg: string, on: string, min: number) => {
    const r = contrast(fg, on);
    if (!(r >= min)) out.push(`${label} ${r.toFixed(2)} < ${min}`);
  };
  for (const hue of GLYPH_HUES) need(`${hue} glyph (accent-text/tint-bg)`, t(`--accent-${hue}-text`), t(`--tint-${hue}-bg`), 3);
  for (const hue of MARKER_HUES) need(`${hue} marker (accent-text/bg-secondary)`, t(`--accent-${hue}-text`), t("--bg-secondary"), 4.5);
  if (base) need("text-secondary/bg-secondary", t("--text-secondary"), t("--bg-secondary"), 4.5);
  return out;
}

describe("card pill token contrast — glyph chip 3:1 (E2)", () => {
  it.each(PALETTES)("%s glyph chips meet 3:1", (_name, mode, vars) => {
    expect(failures(vars, mode, false).filter((f) => f.includes("glyph"))).toEqual([]);
  });
});

describe("card pill token contrast — marker + secondary text 4.5:1 (E3)", () => {
  it.each(PALETTES)("%s markers meet 4.5:1", (name, mode, vars) => {
    const base = name.startsWith("base:");
    expect(failures(vars, mode, base).filter((f) => !f.includes("glyph"))).toEqual([]);
  });

  it("the assertion bites: a low-contrast fixture fails and names hue + ratio", () => {
    const bad = {
      "--bg-secondary": "#e1e2e7",
      "--text-secondary": "#8a8a8a",
      ...Object.fromEntries(MARKER_HUES.map((h) => [`--accent-${h}-text`, "#8a8a8a"])),
      ...Object.fromEntries(GLYPH_HUES.map((h) => [`--tint-${h}-bg`, "#e1e2e7"])),
    };
    const out = failures(bad, "light", true);
    expect(out.length).toBeGreaterThan(0);
    expect(out.join("\n")).toMatch(/orange marker .*\d\.\d\d < 4\.5/);
  });
});
