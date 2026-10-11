/**
 * `art cutout` (spec deck3d-art-tooling): colour-to-alpha against `--bg`
 * (GIMP-style: each pixel's alpha is the least opacity that reproduces it
 * over the background, and its colour is un-blended accordingly), optional
 * split into one image per 8-connected opaque region with a source-pixel
 * bounding-box index, and an optional `--max` downscale of each output.
 */
import { cropRgba, type RgbaImage, resizeRgba } from "./png.js";
import { parseHex } from "./trace.js";

export function colorToAlpha(img: RgbaImage, bgHex: string): RgbaImage {
  const bg = parseHex(bgHex);
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const v = img.data[i + c];
      const b = bg[c];
      const ac = v > b ? (v - b) / (255 - b || 1) : v < b ? (b - v) / (b || 1) : 0;
      a = Math.max(a, ac);
    }
    const srcA = img.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const v = img.data[i + c];
      out[i + c] = a > 0 ? Math.round(Math.min(255, Math.max(0, (v - bg[c]) / a + bg[c]))) : 0;
    }
    out[i + 3] = Math.round(a * srcA * 255);
  }
  return { width: img.width, height: img.height, data: out };
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 8-connected regions of pixels with alpha above `threshold`, scan order; tiny ones dropped. */
export function opaqueRegions(img: RgbaImage, threshold = 8, minArea = 16): Region[] {
  const { width, height, data } = img;
  const seen = new Uint8Array(width * height);
  const out: Region[] = [];
  const stack: number[] = [];
  for (let s = 0; s < width * height; s++) {
    if (seen[s] || data[s * 4 + 3] <= threshold) continue;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p / width) | 0;
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!seen[q] && data[q * 4 + 3] > threshold) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (count >= minArea) out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return out;
}

/** Downscale so the longest side is at most `max` (never upscales). */
export function fitMax(img: RgbaImage, max: number | undefined): RgbaImage {
  if (!max || Math.max(img.width, img.height) <= max) return img;
  const k = max / Math.max(img.width, img.height);
  return resizeRgba(img, img.width * k, img.height * k);
}

export interface CutoutPiece {
  region: Region;
  image: RgbaImage;
}

export function cutout(img: RgbaImage, bgHex: string, opts: { split?: boolean; max?: number } = {}): CutoutPiece[] {
  const alpha = colorToAlpha(img, bgHex);
  if (!opts.split) return [{ region: { x: 0, y: 0, w: img.width, h: img.height }, image: fitMax(alpha, opts.max) }];
  return opaqueRegions(alpha).map((r) => ({ region: r, image: fitMax(cropRgba(alpha, r.x, r.y, r.w, r.h), opts.max) }));
}
