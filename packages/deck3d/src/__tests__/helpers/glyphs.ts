/**
 * Pure-TS glyph rasteriser for tests: Poppins outlines → rings → an RGBA
 * buffer (non-zero winding, pixel-centre sampling). Keeps the trace core's
 * tests browser-free and gives art3d tests a real wordmark.
 */
import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import type { RgbaImage } from "../../art/png.js";
import { FONT_PATH } from "../../render/index.js";

export const font = opentype.parse(new Uint8Array(readFileSync(FONT_PATH)).buffer);

export type Ring = Array<[number, number]>;

/** Glyph outlines of `text` at `size` px, flattened to rings. */
export function glyphRings(text: string, x: number, y: number, size: number): Ring[] {
  const rings: Ring[] = [];
  let cur: Ring = [];
  let pos: [number, number] = [0, 0];
  for (const c of font.getPath(text, x, y, size).commands) {
    if (c.type === "M") {
      if (cur.length) rings.push(cur);
      cur = [[c.x, c.y]];
      pos = [c.x, c.y];
    } else if (c.type === "L") {
      cur.push([c.x, c.y]);
      pos = [c.x, c.y];
    } else if (c.type === "Q" || c.type === "C") {
      const p0 = pos;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const u = 1 - t;
        if (c.type === "Q") cur.push([u * u * p0[0] + 2 * u * t * c.x1 + t * t * c.x, u * u * p0[1] + 2 * u * t * c.y1 + t * t * c.y]);
        else
          cur.push([
            u * u * u * p0[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * p0[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          ]);
      }
      pos = [c.x, c.y];
    } else if (c.type === "Z" && cur.length) {
      rings.push(cur);
      cur = [];
    }
  }
  if (cur.length) rings.push(cur);
  return rings;
}

/** Non-zero winding fill of rings into an RGBA buffer (sample at pixel centres). */
export function fill(img: RgbaImage, rings: Ring[], rgb: [number, number, number]): void {
  for (let y = 0; y < img.height; y++) {
    const sy = y + 0.5;
    for (let x = 0; x < img.width; x++) {
      const sx = x + 0.5;
      let wind = 0;
      for (const r of rings) {
        for (let i = 0; i < r.length; i++) {
          const [x1, y1] = r[i];
          const [x2, y2] = r[(i + 1) % r.length];
          if (y1 <= sy && y2 > sy && (x2 - x1) * (sy - y1) - (sx - x1) * (y2 - y1) > 0) wind++;
          else if (y1 > sy && y2 <= sy && (x2 - x1) * (sy - y1) - (sx - x1) * (y2 - y1) < 0) wind--;
        }
      }
      if (wind !== 0) img.data.set([...rgb, 255], (y * img.width + x) * 4);
    }
  }
}

export function canvas(w: number, h: number, bg: [number, number, number]): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
  return { width: w, height: h, data };
}

