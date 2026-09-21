/**
 * Text: extruded titles (opentype.js TTF → ShapePath → ExtrudeGeometry) and
 * canvas labels with an inverted background-colour outline (design D4).
 *
 * Finding ported from the lab: every three.js example `typeface.json` ships
 * corrupt double-acute outlines (`ő ű Ő Ű`) → earcut streaks. A real TTF via
 * opentype.js is the only clean path, so there is no typeface fallback.
 */

import type { Font } from "opentype.js";
import opentype from "opentype.js";
import * as THREE from "three";
import type { PaletteColors } from "./palette.js";

const LABEL_FONT = "Poppins, sans-serif";

/** Parse the embedded TTF (base64) into an opentype Font. */
export function loadFont(base64: string): Font {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return opentype.parse(bytes.buffer);
}

/** Greedy word-wrap. */
export function wrap(text: string, max = 18): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (`${line} ${w}`.trim().length > max) {
      out.push(line.trim());
      line = w;
    } else {
      line += ` ${w}`;
    }
  }
  out.push(line.trim());
  return out;
}

/** opentype outline → THREE.Shape[] (Y flipped: opentype is Y-down). */
export function ttfShapes(font: Font, text: string, size: number): THREE.Shape[] {
  const sp = new THREE.ShapePath();
  for (const c of font.getPath(text, 0, 0, size).commands) {
    if (c.type === "M") sp.moveTo(c.x, -c.y);
    else if (c.type === "L") sp.lineTo(c.x, -c.y);
    else if (c.type === "Q") sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === "C") sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    else if (c.type === "Z") sp.currentPath?.closePath();
  }
  return sp.toShapes(false);
}

export interface TitleResult {
  group: THREE.Group;
  missing: Set<string>;
  lines: number;
}

/**
 * Extruded hero text (multi-line, wrapped).
 *
 * `mat` may be a two-entry array: `ExtrudeGeometry` emits one group pair per
 * glyph shape — material 0 = the front/back faces, material 1 = the extrusion
 * walls plus the bevel — so `[face, edge]` draws a contour around every
 * character (`defaults.titleEdge`).
 */
export function buildTitle(
  font: Font,
  text: string,
  size: number,
  depth: number,
  mat: THREE.Material | THREE.Material[],
): TitleResult {
  const group = new THREE.Group();
  const missing = new Set<string>();
  const ex = {
    depth,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: depth * 0.15,
    bevelSize: size * 0.025,
    bevelSegments: 3,
  };
  const lines = wrap(text, size > 0.3 ? 18 : 40);
  lines.forEach((line, li) => {
    for (const ch of line) if (ch !== " " && !font.hasChar(ch)) missing.add(ch);
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(ttfShapes(font, line, size), ex), mat);
    mesh.castShadow = true;
    mesh.position.y = -li * size * 1.35;
    group.add(mesh);
  });
  return { group, missing, lines: lines.length };
}

export interface LabelHandle {
  group: THREE.Group;
  /** World height of the label plane (for measurement). */
  height: number;
  canvasWidth: number;
}

/**
 * Flat, unlit canvas label with a background-colour outline — readable at any
 * size in both modes, never blooms (`toneMapped:false`).
 */
export function buildLabel(str: string, size: number, P: PaletteColors): LabelHandle {
  const px = 96;
  const pad = 18;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const fontSpec = `700 ${px}px ${LABEL_FONT}`;
  ctx.font = fontSpec;
  const w = Math.ceil(ctx.measureText(str).width) + pad * 2;
  canvas.width = w;
  canvas.height = px + pad * 2;
  ctx.font = fontSpec;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = px * 0.18;
  ctx.strokeStyle = P.bg;
  ctx.fillStyle = P.text;
  ctx.strokeText(str, pad, canvas.height / 2);
  ctx.fillText(str, pad, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const h = size * 1.15;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry((h * canvas.width) / canvas.height, h),
    // `depthTest: false`: a caption is an annotation, not scenery. With depth
    // on, the plinth swallowed the bottom caption and the globe swallowed its
    // own far-side ones. Every caller is a diagram label (builders.ts only),
    // so this cannot lift chrome or body text out of the depth order.
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
  );
  plane.renderOrder = 12;
  const group = new THREE.Group();
  group.add(plane);
  return { group, height: h, canvasWidth: canvas.width };
}

/** Bullet panel texture (subtitle + accent bullets). */
export function bulletTexture(
  slide: { subtitle?: string; bullets: string[] },
  P: PaletteColors,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.textBaseline = "top";
  let y = 20;
  if (slide.subtitle) {
    g.globalAlpha = 0.8;
    g.font = "400 40px sans-serif";
    g.fillStyle = P.text;
    g.fillText(slide.subtitle, 0, y);
    g.globalAlpha = 1;
    y += 80;
  }
  g.font = "500 38px sans-serif";
  for (const b of slide.bullets) {
    g.fillStyle = P.accent;
    g.beginPath();
    g.arc(14, y + 20, 8, 0, 7);
    g.fill();
    g.fillStyle = P.text;
    g.fillText(b, 44, y);
    y += 72;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
