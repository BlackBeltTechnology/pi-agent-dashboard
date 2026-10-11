/**
 * Theme colour scheme, fonts, and DrawingML colour resolution
 * (`srgbClr | schemeClr | sysClr | prstClr` + `lumMod/lumOff/tint/shade/satMod/alpha`).
 */
import type { ThemeInfo } from "./types.js";
import { child, num, path, type XNode } from "./xml.js";

export interface ResolvedColor {
  hex: string;
  alpha: number;
}

/** Master `p:clrMap`: logical slot (`bg1`, `tx1`, …) → scheme slot (`lt1`, `dk1`, …). */
export type ClrMap = Record<string, string>;

export const DEFAULT_CLR_MAP: ClrMap = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

const SCHEME_SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

const PRESET: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
};

function normHex(v: string | undefined): string | undefined {
  if (!v || !/^[0-9a-fA-F]{6}$/.test(v)) return undefined;
  return `#${v.toLowerCase()}`;
}

export function parseTheme(theme: XNode | undefined): ThemeInfo {
  const colors: Record<string, string> = {};
  const scheme = path(theme, "a:themeElements", "a:clrScheme");
  for (const slot of SCHEME_SLOTS) {
    const node = child(scheme, `a:${slot}`);
    const srgb = normHex(child(node, "a:srgbClr")?.attrs.val);
    const sys = normHex(child(node, "a:sysClr")?.attrs.lastClr);
    colors[slot] = srgb ?? sys ?? (slot.startsWith("dk") ? "#000000" : "#ffffff");
  }
  const fonts = path(theme, "a:themeElements", "a:fontScheme");
  return {
    colors,
    fonts: {
      major: path(fonts, "a:majorFont", "a:latin")?.attrs.typeface ?? "Calibri Light",
      minor: path(fonts, "a:minorFont", "a:latin")?.attrs.typeface ?? "Calibri",
    },
  };
}

export function parseClrMap(node: XNode | undefined): ClrMap {
  return node ? { ...DEFAULT_CLR_MAP, ...node.attrs } : { ...DEFAULT_CLR_MAP };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Apply DrawingML colour transforms in document order. */
function applyMods(hex: string, mods: XNode[]): ResolvedColor {
  let [r, g, b] = hexToRgb(hex);
  let alpha = 1;
  for (const m of mods) {
    const v = num(m.attrs.val) / 100000;
    switch (m.name) {
      case "a:lumMod":
      case "a:lumOff": {
        const [h, s, l] = rgbToHsl(r, g, b);
        const nl = m.name === "a:lumMod" ? l * v : l + v;
        [r, g, b] = hslToRgb(h, s, clamp01(nl));
        break;
      }
      case "a:satMod": {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb(h, clamp01(s * v), l);
        break;
      }
      case "a:tint":
        r += (255 - r) * (1 - v);
        g += (255 - g) * (1 - v);
        b += (255 - b) * (1 - v);
        break;
      case "a:shade":
        r *= v;
        g *= v;
        b *= v;
        break;
      case "a:alpha":
        alpha = clamp01(v);
        break;
      default:
        break;
    }
  }
  return { hex: rgbToHex(r, g, b), alpha };
}

export interface ColorEnv {
  theme: ThemeInfo;
  clrMap: ClrMap;
  /** Placeholder colour (`phClr`) supplied by a style reference. */
  phClr?: string;
}

/** Resolve the colour child of a fill-like node (`a:solidFill`, `a:fontRef`, …). */
export function resolveColor(holder: XNode | undefined, env: ColorEnv): ResolvedColor | undefined {
  if (!holder) return undefined;
  for (const c of holder.children) {
    let base: string | undefined;
    if (c.name === "a:srgbClr") base = normHex(c.attrs.val);
    else if (c.name === "a:sysClr") base = normHex(c.attrs.lastClr) ?? (c.attrs.val === "window" ? "#ffffff" : "#000000");
    else if (c.name === "a:prstClr") base = PRESET[c.attrs.val ?? ""] ?? "#000000";
    else if (c.name === "a:schemeClr") {
      const val = c.attrs.val ?? "tx1";
      if (val === "phClr") base = env.phClr ?? env.theme.colors.dk1;
      else base = env.theme.colors[env.clrMap[val] ?? val] ?? env.theme.colors.dk1;
    } else continue;
    if (!base) continue;
    return applyMods(base, c.children);
  }
  return undefined;
}

/** Relative luminance (0–1) of a `#rrggbb` colour, sRGB → linear. */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
