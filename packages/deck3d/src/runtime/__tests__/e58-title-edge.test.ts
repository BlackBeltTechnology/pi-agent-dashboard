/**
 * E58 (Section 21) — runtime: the extruded-title contour.
 *
 * An extruded glyph lit from the front is a solid silhouette: adjacent letters
 * merge and the character shape is carried only by the gaps. `titleEdge:
 * "contrast"` paints the SIDE walls — `ExtrudeGeometry`'s second material
 * group, which is the bevel plus the extrusion walls — in the palette's text
 * colour, so every character keeps a hard contour against its own face.
 *
 * The invariant this test pins is the one that silently breaks: that
 * `ExtrudeGeometry` really does emit a group for the faces and a separate one
 * for the sides, in that order. If three ever merged them, the two-material
 * array would paint the whole glyph and the contour would vanish with no error.
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Palette } from "../../ir/types.js";
import { BLOOM_CEILING, EDGE_CONTRAST_FLOOR, titleEdgeColour, titleEdgeMaterial, titleMaterial } from "../materials.js";
import { PALETTES, resolvePalette } from "../palette.js";
import { buildTitle, loadFont } from "../text.js";

const FONT = loadFont(readFileSync(new URL("../../../assets/Poppins-Bold.ttf", import.meta.url)).toString("base64"));
const CFG = { mode: "dark" as const, palette: "blackbelt" as const };
const P = resolvePalette(CFG);

/**
 * WCAG relative luminance, decoded from the sRGB BYTES. `THREE.Color` stores
 * linear values under colour management, so decoding `.r/.g/.b` as if they
 * were sRGB double-counts and quietly reports the wrong ratio.
 */
function lum(hex: string): number {
  const n = new THREE.Color(hex).getHex(THREE.SRGBColorSpace);
  const ch = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(((n >> 16) & 255) / 255) + 0.7152 * ch(((n >> 8) & 255) / 255) + 0.0722 * ch((n & 255) / 255);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function meshes(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

describe("E58 extruded title contour", () => {
  it("emits exactly two geometry groups — faces then sides", () => {
    const { group } = buildTitle(FONT, "Ab", 0.5, 0.18, titleMaterial(P, CFG));
    const geo = meshes(group)[0].geometry;
    // One (faces, sides) pair PER GLYPH shape, in that order — two here.
    expect(geo.groups.map((g) => g.materialIndex)).toEqual([0, 1, 0, 1]);
    // Sides carry the bevel too, so they are never an empty group.
    for (const g of geo.groups) expect(g.count).toBeGreaterThan(0);
  });

  it("paints the side walls in the palette contour colour, leaving the face lit", () => {
    const face = titleMaterial(P, CFG);
    const { group } = buildTitle(FONT, "Ab", 0.5, 0.18, [face, titleEdgeMaterial(P)]);
    const mats = meshes(group)[0].material as THREE.Material[];
    expect(Array.isArray(mats)).toBe(true);
    expect((mats[0] as THREE.MeshPhysicalMaterial).color.getHexString()).toBe(new THREE.Color(P.accent).getHexString());
    expect((mats[1] as THREE.MeshBasicMaterial).color.getHexString()).toBe(new THREE.Color(titleEdgeColour(P)).getHexString());
    // blackbelt/dark: palette text is #FFFFFF, dimmed just under the bloom
    // ceiling. Pinned literally — a regression here is a halo, not a crash.
    expect(titleEdgeColour(P).toLowerCase()).toBe("#e7e7e7");
  });

  it("holds every palette's contour under the bloom ceiling", () => {
    // Post-processing renders to a target, where three skips in-shader tone
    // mapping — so a 1.0 contour reaches the bloom pass at 1.0 and halos.
    for (const id of Object.keys(PALETTES) as Array<Exclude<Palette, "custom">>) {
      for (const mode of ["dark", "light"] as const) {
        const c = new THREE.Color(titleEdgeColour(resolvePalette({ mode, palette: id })));
        const linear = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        // +0.01: the dimmed colour round-trips through an 8-bit hex string.
        expect(linear, `${id}/${mode} contour luminance`).toBeLessThanOrEqual(BLOOM_CEILING + 0.01);
      }
    }
  });

  it("pushes only lightness when the palette text colour is too close to the face", () => {
    // ember/dark: the palette text is near-white against a bright amber face,
    // so the contour has to travel DOWN. Hue and saturation must survive.
    const P = resolvePalette({ mode: "dark", palette: "ember" });
    expect(ratio(P.text, P.accent)).toBeLessThan(EDGE_CONTRAST_FLOOR);
    const pushed = new THREE.Color(titleEdgeColour(P)).getHSL({ h: 0, s: 0, l: 0 });
    const text = new THREE.Color(P.text).getHSL({ h: 0, s: 0, l: 0 });
    // 2dp: the candidate round-trips through an 8-bit hex string.
    expect(pushed.h).toBeCloseTo(text.h, 2);
    expect(pushed.s).toBeCloseTo(text.s, 2);
    expect(pushed.l).not.toBeCloseTo(text.l, 2);
  });

  it("makes the contour unlit, so a wall turned away from the light still reads", () => {
    // The side walls are near-perpendicular to the camera — a lit material
    // goes black exactly there, which is the case the switch exists to fix.
    const edge = titleEdgeMaterial(P) as THREE.MeshBasicMaterial;
    expect(edge.type).toBe("MeshBasicMaterial");
    // But tone-mapped like the rest of the scene, and held under the bloom
    // ceiling: an unlit white wall halos worse than the merged silhouette.
    expect(edge.toneMapped).toBe(true);
  });

  it("keeps one material when the switch is off", () => {
    const { group } = buildTitle(FONT, "Ab", 0.5, 0.18, titleMaterial(P, CFG));
    expect(Array.isArray(meshes(group)[0].material)).toBe(false);
  });

  it("clears a contrast floor against BOTH the face and the background, every palette", () => {
    for (const id of Object.keys(PALETTES) as Array<Exclude<Palette, "custom">>) {
      for (const mode of ["dark", "light"] as const) {
        const colours = resolvePalette({ mode, palette: id });
        const edge = `#${(titleEdgeMaterial(colours) as THREE.MeshBasicMaterial).color.getHexString()}`;
        // Against the face, or the contour is invisible ON the glyph.
        expect(ratio(edge, colours.accent), `${id}/${mode} contour vs face`).toBeGreaterThanOrEqual(EDGE_CONTRAST_FLOOR);
        // Against the background, or the outer silhouette is invisible.
        expect(ratio(edge, colours.bg), `${id}/${mode} contour vs background`).toBeGreaterThan(2);
      }
    }
  });
});
