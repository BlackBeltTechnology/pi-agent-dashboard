/** PBR material presets (glass / metal / matte), mode- and env-aware. */
import * as THREE from "three";
import type { PaletteColors } from "./palette.js";
import type { SlideConfig } from "./types.js";

export type MaterialRole = "accent" | "second";

function glassMaterial(col: string, role: MaterialRole, envOn: boolean): THREE.Material {
  if (role === "accent") {
    return new THREE.MeshPhysicalMaterial({
      color: col,
      metalness: 0.9,
      roughness: 0.18,
      envMapIntensity: envOn ? 1.4 : 0,
      emissive: col,
      emissiveIntensity: 0.25,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: col,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.85,
    thickness: 0.8,
    ior: 1.45,
    envMapIntensity: envOn ? 1.2 : 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

export function diagramMaterial(P: PaletteColors, role: MaterialRole, cfg: SlideConfig): THREE.Material {
  const col = role === "accent" ? P.accent : P.second;
  const envOn = cfg.envReflections !== false;
  const material = cfg.material ?? "glass";
  if (material === "glass") return glassMaterial(col, role, envOn);
  if (material === "metal") {
    return new THREE.MeshStandardMaterial({
      color: col,
      metalness: 1,
      roughness: role === "accent" ? 0.22 : 0.38,
      envMapIntensity: envOn ? 1.6 : 0,
    });
  }
  return new THREE.MeshStandardMaterial({ color: col, metalness: 0.1, roughness: 0.75 });
}

/** Relative luminance (WCAG), for picking the contour colour by contrast. */
function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  const ch = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Contour material for extruded title SIDE walls (`titleEdge: "contrast"`).
 *
 * Unlit on purpose. The side walls are near-perpendicular to the camera, which
 * is exactly where a lit material goes black — the contour would disappear in
 * the case the switch exists to fix. `toneMapped: false` keeps it out of the
 * bloom/tone-mapping wash for the same reason the canvas labels do.
 *
 * The colour is the palette's own `text` colour — same hue discipline as the
 * canvas labels. It must clear a contrast floor against BOTH the lit face (or
 * the contour is invisible on the glyph) and the background (or the outer
 * silhouette is invisible). `text` alone is not always enough: in
 * `forest/light` it sits at ratio 1.46 against the accent. Where it falls
 * short, only its LIGHTNESS is pushed away from the face — hue and saturation
 * are left alone, so the contour still reads as the palette's colour.
 */
export const EDGE_CONTRAST_FLOOR = 2.2;

export function titleEdgeColour(P: PaletteColors): string {
  const base = new THREE.Color(P.text);
  if (contrast(P.text, P.accent) >= EDGE_CONTRAST_FLOOR) return P.text;
  // Push away from the face: lighter when the face is dark, darker when light.
  const up = luminance(P.accent) < 0.35;
  const hsl = base.getHSL({ h: 0, s: 0, l: 0 });
  for (let step = 1; step <= 20; step++) {
    const l = up ? Math.min(0.98, hsl.l + step * 0.05) : Math.max(0.04, hsl.l - step * 0.05);
    const candidate = `#${new THREE.Color().setHSL(hsl.h, hsl.s, l).getHexString()}`;
    if (contrast(candidate, P.accent) >= EDGE_CONTRAST_FLOOR) return candidate;
    if (l >= 0.98 || l <= 0.04) return candidate;
  }
  return P.text;
}

export function titleEdgeMaterial(P: PaletteColors): THREE.Material {
  return new THREE.MeshBasicMaterial({ color: titleEdgeColour(P), toneMapped: false });
}

export function titleMaterial(P: PaletteColors, cfg: SlideConfig): THREE.Material {
  return new THREE.MeshPhysicalMaterial({
    color: P.accent,
    metalness: 0.85,
    roughness: 0.2,
    envMapIntensity: cfg.envReflections !== false ? 1.5 : 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
    emissive: P.accent,
    emissiveIntensity: cfg.mode === "dark" ? 0.05 : 0,
  });
}
