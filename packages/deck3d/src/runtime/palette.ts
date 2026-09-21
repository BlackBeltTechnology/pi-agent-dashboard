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
