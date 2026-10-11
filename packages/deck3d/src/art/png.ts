/**
 * Pure-TS PNG codec on RGBA buffers (node `zlib`, no native image deps).
 *
 * The encoder writes 8-bit RGBA, filter 0 — deterministic for identical
 * pixels. The decoder reads 8-bit non-interlaced greyscale, RGB, palette,
 * grey+alpha and RGBA, which covers chromium screenshots and the files this
 * package writes; anything else is decoded in the sandboxed page instead.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const parts = [new Uint8Array(SIG), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(idat)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function isPng(bytes: Uint8Array): boolean {
  return SIG.every((b, i) => bytes[i] === b);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!isPng(bytes)) throw new Error("not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    const t = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (t === "PLTE") palette = data;
    else if (t === "tRNS") trns = data;
    else if (t === "IDAT") idat.push(data);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`unsupported PNG colour type ${type}`);
  const total = idat.reduce((a, c) => a + c.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = new Uint8Array(inflateSync(joined));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels] : 0;
      const b = y > 0 ? pixels[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[row - stride + x - channels] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) v += paeth(a, b, c);
      pixels[row + x] = v & 255;
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r: number;
    let g: number;
    let b: number;
    let al = 255;
    if (type === 0) {
      r = g = b = pixels[s];
    } else if (type === 2) {
      [r, g, b] = [pixels[s], pixels[s + 1], pixels[s + 2]];
    } else if (type === 3) {
      const idx = pixels[s];
      [r, g, b] = [palette?.[idx * 3] ?? 0, palette?.[idx * 3 + 1] ?? 0, palette?.[idx * 3 + 2] ?? 0];
      al = trns && idx < trns.length ? trns[idx] : 255;
    } else if (type === 4) {
      r = g = b = pixels[s];
      al = pixels[s + 1];
    } else {
      [r, g, b, al] = [pixels[s], pixels[s + 1], pixels[s + 2], pixels[s + 3]];
    }
    out.set([r, g, b, al], i * 4);
  }
  return { width, height, data: out };
}

/** Copy a sub-rectangle (clamped to the image; pixels outside are transparent). */
export function cropRgba(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const X = Math.round(x);
  const Y = Math.round(y);
  const out = new Uint8Array(W * H * 4);
  for (let row = 0; row < H; row++) {
    const sy = Y + row;
    if (sy < 0 || sy >= img.height) continue;
    for (let col = 0; col < W; col++) {
      const sx = X + col;
      if (sx < 0 || sx >= img.width) continue;
      const si = (sy * img.width + sx) * 4;
      out.set(img.data.subarray(si, si + 4), (row * W + col) * 4);
    }
  }
  return { width: W, height: H, data: out };
}

/** Bilinear resize to `w` × `h`. */
export function resizeRgba(img: RgbaImage, w: number, h: number): RgbaImage {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const out = new Uint8Array(W * H * 4);
  const sx = img.width / W;
  const sy = img.height / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c];
        const b = img.data[(y0 * img.width + x1) * 4 + c];
        const d = img.data[(y1 * img.width + x0) * 4 + c];
        const e = img.data[(y1 * img.width + x1) * 4 + c];
        out[(y * W + x) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return { width: W, height: H, data: out };
}
