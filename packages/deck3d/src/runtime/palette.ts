import * as THREE from "three";
/**
 * Palette resolution (ported from the strategy lab). A named palette plus
 * mode yields the five colours; `custom` derives bg/text from the card colour.
 */
import { Color } from "three";
import type { Mode, Palette } from "../ir/types.js";
import type { SlideConfig } from "./types.js";

export interface PaletteColors {
  accent: string;
  second: string;
  bg: string;
  card: string;
  text: string;
}

interface PaletteDef {
  accent: string;
  second: string;
  dark: { bg: string; card: string; text: string };
  light: { bg: string; card: string; text: string };
}

export const PALETTES: Record<Exclude<Palette, "custom">, PaletteDef> = {
  blackbelt: {
    accent: "#FF5722",
    second: "#9E9E9E",
    dark: { bg: "#1a1a1c", card: "#3a3a3d", text: "#FFFFFF" },
    light: { bg: "#E8E8EA", card: "#FFFFFF", text: "#2b2b2b" },
  },
  zenit: {
    accent: "#F47A20",
    second: "#4472C4",
    dark: { bg: "#08101e", card: "#1F3A5F", text: "#FFFFFF" },
    light: { bg: "#F3F1EC", card: "#FFFFFF", text: "#1F3A5F" },
  },
  dapp: {
    accent: "#6366F1",
    second: "#22C55E",
    dark: { bg: "#0B1120", card: "#1E293B", text: "#F8FAFC" },
    light: { bg: "#F8FAFC", card: "#FFFFFF", text: "#0F172A" },
  },
  midnight: {
    accent: "#818CF8",
    second: "#94A3B8",
    dark: { bg: "#0F172A", card: "#1E293B", text: "#E2E8F0" },
    light: { bg: "#EEF2FF", card: "#FFFFFF", text: "#1E1B4B" },
  },
  ember: {
    accent: "#F59E0B",
    second: "#A8A29E",
    dark: { bg: "#1C1917", card: "#292524", text: "#FAFAF9" },
    light: { bg: "#FFFBEB", card: "#FFFFFF", text: "#292524" },
  },
  arctic: {
    accent: "#06B6D4",
    second: "#64748B",
    dark: { bg: "#07172B", card: "#133046", text: "#E0F2FE" },
    light: { bg: "#F5FCFF", card: "#FFFFFF", text: "#0C4A6E" },
  },
  forest: {
    accent: "#4D7C0F",
    second: "#A16207",
    dark: { bg: "#0F1A0F", card: "#1F2E1B", text: "#F0FDF4" },
    light: { bg: "#FAF8F0", card: "#FFFFFF", text: "#1A2E05" },
  },
  mono: {
    accent: "#FFFFFF",
    second: "#9CA3AF",
    dark: { bg: "#000000", card: "#262626", text: "#FFFFFF" },
    light: { bg: "#FFFFFF", card: "#F5F5F5", text: "#000000" },
  },
  neon: {
    accent: "#FF2E9A",
    second: "#22D3EE",
    dark: { bg: "#05020A", card: "#1A0B24", text: "#FDF4FF" },
    light: { bg: "#FDF2F8", card: "#FFFFFF", text: "#4A044E" },
  },
};

export function resolvePalette(cfg: SlideConfig): PaletteColors {
  const palette = cfg.palette ?? "blackbelt";
  const mode: Mode = cfg.mode ?? "dark";
  if (palette === "custom") {
    const card = cfg.colors?.card ?? "#4A4A4A";
    const c = new Color(card);
    const l = c.getHSL({ h: 0, s: 0, l: 0 }).l;
    const bg = c.clone().offsetHSL(0, 0, mode === "dark" ? -0.12 : 0.35);
    return {
      accent: cfg.colors?.accent ?? "#FF5722",
      second: cfg.colors?.secondary ?? "#9E9E9E",
      bg: `#${bg.getHexString()}`,
      card,
      text: l > 0.6 ? "#222222" : "#FFFFFF",
    };
  }
  const p = PALETTES[palette];
  return { accent: p.accent, second: p.second, ...p[mode] };
}

/**
 * Blend two palettes channel-wise. Used to MORPH the scene look across a
 * transition when neighbouring slides carry different palettes — snapping the
 * background at t=0 changed the world a full `durationSec` before the camera
 * arrived.
 */
export function mixPalette(a: PaletteColors, b: PaletteColors, k: number): PaletteColors {
  const mix = (x: string, y: string): string => `#${new THREE.Color(x).lerp(new THREE.Color(y), k).getHexString()}`;
  return { accent: mix(a.accent, b.accent), second: mix(a.second, b.second), bg: mix(a.bg, b.bg), card: mix(a.card, b.card), text: mix(a.text, b.text) };
}
