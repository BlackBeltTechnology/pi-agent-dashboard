/** Minimal PNG encode/decode (8-bit RGB/RGBA, non-interlaced) for pixel-level assertions. */
import * as zlib from "node:zlib";

export interface Image {
  w: number;
  h: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, body: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

export function encodePng(img: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePng(buf: Buffer): Image {
  let pos = 8;
  let w = 0;
  let h = 0;
  let colour = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit non-interlaced PNG supported");
      colour = body[9];
    } else if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  if (colour !== 2 && colour !== 6) throw new Error(`unsupported PNG colour type ${colour}`);
  const bpp = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        default: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
      }
      cur[i] = v & 0xff;
    }
    for (let px = 0; px < w; px++) {
      const o = (y * w + px) * 4;
      out[o] = cur[px * bpp];
      out[o + 1] = cur[px * bpp + 1];
      out[o + 2] = cur[px * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[px * bpp + 3] : 255;
    }
    prev.set(cur);
  }
  return { w, h, data: out };
}

export const pixel = (img: Image, x: number, y: number): [number, number, number] => {
  const o = (y * img.w + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};

/** Max channel difference between two pixels. */
export const diff = (a: [number, number, number], b: [number, number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** Solid background with optional deterministic noise and discs. */
export function scene(w: number, h: number, bg: [number, number, number], discs: { cx: number; cy: number; r: number; colour: [number, number, number] }[] = [], noise = 0): Image {
  const data = new Uint8Array(w * h * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const disc = discs.find((d) => (x + 0.5 - d.cx) ** 2 + (y + 0.5 - d.cy) ** 2 <= d.r ** 2);
      const base = disc ? disc.colour : bg;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round(base[c] + (noise ? (rnd() - 0.5) * noise : 0))));
      data[o + 3] = 255;
    }
  }
  return { w, h, data };
}
