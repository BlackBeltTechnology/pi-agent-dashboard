/**
 * The macOS tray template once shipped with 6/256 visible pixels — an
 * effectively invisible menu-bar icon (and the tray was the only way to quit).
 * Guard: template images are black-on-alpha and visibly filled.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

const RES = path.resolve(import.meta.dirname, "..", "..", "resources");

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  if (Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)) return a;
  return Math.abs(p - b) <= Math.abs(p - c) ? b : c;
}

/** Undo PNG scanline filters (RGBA8). */
function unfilter(raw: Buffer, w: number, h: number): Buffer {
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? (out[y * stride + x - bpp] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= bpp && y > 0 ? (out[(y - 1) * stride + x - bpp] as number) : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f] as number;
      out[y * stride + x] = ((raw[y * (stride + 1) + 1 + x] as number) + pred) & 0xff;
    }
  }
  return out;
}

/** RGBA8 non-interlaced PNG → alpha channel (filter type 0 / sub / up / avg / paeth). */
function alphaOf(file: string): { w: number; h: number; alpha: number[] } {
  const d = fs.readFileSync(file);
  let i = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (i < d.length) {
    const n = d.readUInt32BE(i);
    const type = d.toString("ascii", i + 4, i + 8);
    const c = d.subarray(i + 8, i + 8 + n);
    if (type === "IHDR") {
      w = c.readUInt32BE(0);
      h = c.readUInt32BE(4);
      expect(c[8], "bit depth").toBe(8);
      expect(c[9], "color type RGBA").toBe(6);
    }
    if (type === "IDAT") idat.push(c);
    i += 12 + n;
  }
  const out = unfilter(zlib.inflateSync(Buffer.concat(idat)), w, h);
  const alpha: number[] = [];
  for (let p = 3; p < out.length; p += 4) alpha.push(out[p] as number);
  return { w, h, alpha };
}

describe("macOS tray template icon", () => {
  for (const [name, size] of [["trayTemplate.png", 16], ["trayTemplate@2x.png", 32]] as const) {
    it(`${name} is ${size}px and visibly filled (≥ 20% of pixels)`, () => {
      const { w, h, alpha } = alphaOf(path.join(RES, name));
      expect([w, h]).toEqual([size, size]);
      const visible = alpha.filter((a) => a > 40).length;
      expect(visible / (w * h)).toBeGreaterThanOrEqual(0.2);
    });
  }
});
