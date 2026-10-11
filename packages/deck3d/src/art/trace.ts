/**
 * `art trace` core (design D2): RGBA buffer → coloured polygons with holes.
 * Plain TS, no browser — unit-tested on synthetic buffers.
 *
 *  1. Classify pixels: background (transparent, or nearest to the corner
 *     colour of an opaque image) vs palette classes (nearest `--palette`
 *     entry; one foreground class when no palette is given).
 *  2. 4-connected components per class (iterative flood fill).
 *  3. Boundary loops by crack following along pixel edges, each pixel's
 *     edges walked clockwise on screen: the outer loop comes out with a
 *     positive shoelace area in image coordinates, every hole negative.
 *  4. Collinear staircase merge + Ramer–Douglas–Peucker at `--tolerance`.
 *
 * Output is a pure function of (pixels, flags): byte-identical JSON.
 */
import type { RgbaImage } from "./png.js";

export type Pt = [number, number];

export interface TracedPolygon {
  color: string;
  /** Outer ring, positive shoelace area in image coordinates. */
  outer: Pt[];
  /** Hole rings, negative shoelace area, each inside `outer`. */
  holes: Pt[][];
}

export interface Outline {
  version: 1;
  width: number;
  height: number;
  polygons: TracedPolygon[];
}

export interface TraceOptions {
  palette?: string[];
  /** Regions (and holes) with fewer pixels are dropped. Default 16. */
  minArea?: number;
  /** RDP tolerance in px. Default 1. */
  tolerance?: number;
}

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad colour '${hex}' (expected #rrggbb)`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const d2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Signed shoelace area in image coordinates. */
export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Class per pixel: -1 background, else palette index (0 without a palette). */
function classify(img: RgbaImage, palette: Rgb[]): Int16Array {
  const { width, height, data } = img;
  const n = width * height;
  const cls = new Int16Array(n);
  let transparent = false;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 250) transparent = true;
  // Opaque image: the commonest corner colour is the background.
  let bg: Rgb | undefined;
  if (!transparent) {
    const corners = [0, width - 1, (height - 1) * width, n - 1].map((i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] as Rgb);
    const counts = corners.map((c) => corners.filter((o) => d2(o, c) < 300).length);
    bg = corners[counts.indexOf(Math.max(...counts))];
  }
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    const c: Rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    if (transparent ? a < 128 : false) {
      cls[i] = -1;
      continue;
    }
    if (palette.length) {
      let best = -1;
      let bestD = bg ? d2(c, bg) : Number.POSITIVE_INFINITY;
      palette.forEach((p, k) => {
        const d = d2(c, p);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      cls[i] = best;
    } else {
      cls[i] = bg && d2(c, bg) < 48 * 48 * 3 ? -1 : 0;
    }
  }
  return cls;
}

/** 4-connected components of one class, in scan order of their first pixel. */
function components(cls: Int16Array, width: number, height: number): Array<{ cls: number; pixels: number[] }> {
  const seen = new Uint8Array(cls.length);
  const out: Array<{ cls: number; pixels: number[] }> = [];
  const stack: number[] = [];
  for (let start = 0; start < cls.length; start++) {
    if (seen[start] || cls[start] < 0) continue;
    const c = cls[start];
    const pixels: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      pixels.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of nb) {
        if (q >= 0 && !seen[q] && cls[q] === c) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    out.push({ cls: c, pixels });
  }
  return out;
}

/**
 * Boundary loops of a pixel set by crack following. Each member pixel
 * contributes its sides facing a non-member, directed clockwise on screen;
 * at a saddle vertex the walk turns right first, which keeps diagonal
 * neighbours apart (4-connectivity).
 */
function boundaryLoops(member: (x: number, y: number) => boolean, pixels: number[], width: number): Pt[][] {
  // Edge key: start vertex → list of [endX, endY, dir].
  const out = new Map<number, Array<[number, number, number]>>();
  const W = width + 1;
  const add = (x1: number, y1: number, x2: number, y2: number, dir: number) => {
    const k = y1 * W + x1;
    const list = out.get(k);
    if (list) list.push([x2, y2, dir]);
    else out.set(k, [[x2, y2, dir]]);
  };
  // dir: 0 right, 1 down, 2 left, 3 up (screen).
  for (const p of pixels) {
    const x = p % width;
    const y = (p / width) | 0;
    if (!member(x, y - 1)) add(x, y, x + 1, y, 0);
    if (!member(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
    if (!member(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
    if (!member(x - 1, y)) add(x, y + 1, x, y, 3);
  }
  const loops: Pt[][] = [];
  const keys = [...out.keys()].sort((a, b) => a - b);
  for (const startKey of keys) {
    while ((out.get(startKey)?.length ?? 0) > 0) {
      const sx = startKey % W;
      const sy = (startKey / W) | 0;
      const ring: Pt[] = [[sx, sy]];
      let key = startKey;
      let dirIn = -1;
      for (;;) {
        const list = out.get(key) as Array<[number, number, number]>;
        // Prefer a right turn, then straight, then left.
        let pick = 0;
        if (list.length > 1 && dirIn >= 0) {
          for (const d of [(dirIn + 1) % 4, dirIn, (dirIn + 3) % 4]) {
            const i = list.findIndex((e) => e[2] === d);
            if (i >= 0) {
              pick = i;
              break;
            }
          }
        }
        const [ex, ey, dir] = list.splice(pick, 1)[0];
        if (!list.length) out.delete(key);
        dirIn = dir;
        key = ey * W + ex;
        if (key === startKey) break;
        ring.push([ex, ey]);
      }
      loops.push(ring);
    }
  }
  return loops;
}

/** Drop vertices on a straight run (the pixel staircase's collinear points). */
function mergeCollinear(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out.length >= 3 ? out : ring;
}

function rdp(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, idx + 1), tol).slice(0, -1), ...rdp(points.slice(idx), tol)];
}

/** RDP on a closed ring: split at the vertex farthest from the first. */
function simplifyRing(ring: Pt[], tol: number): Pt[] {
  const r = mergeCollinear(ring);
  if (r.length <= 4 || tol <= 0) return r;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(r.slice(0, far + 1), tol);
  const b = rdp([...r.slice(far), r[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : r;
}

function dominantColor(img: RgbaImage, pixels: number[]): Rgb {
  const counts = new Map<number, number>();
  for (const p of pixels) {
    const k = (img.data[p * 4] << 16) | (img.data[p * 4 + 1] << 8) | img.data[p * 4 + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

export function traceImage(img: RgbaImage, opts: TraceOptions = {}): Outline {
  const palette = (opts.palette ?? []).map(parseHex);
  const minArea = opts.minArea ?? 16;
  const tol = opts.tolerance ?? 1;
  const { width, height } = img;
  const cls = classify(img, palette);
  const polygons: TracedPolygon[] = [];
  for (const comp of components(cls, width, height)) {
    if (comp.pixels.length < minArea) continue;
    const set = new Uint8Array(width * height);
    for (const p of comp.pixels) set[p] = 1;
    const member = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && set[y * width + x] === 1;
    const loops = boundaryLoops(member, comp.pixels, width).map((ring) => ({ ring, area: signedArea(ring) }));
    const outer = loops.filter((l) => l.area > 0).sort((a, b) => b.area - a.area)[0];
    if (!outer) continue;
    const holes = loops.filter((l) => l.area < 0 && -l.area >= minArea).map((l) => simplifyRing(l.ring, tol));
    const color = palette.length ? palette[comp.cls] : dominantColor(img, comp.pixels);
    polygons.push({
      color: toHex(color),
      outer: simplifyRing(outer.ring, tol),
      holes: holes.filter((h) => signedArea(h) < 0),
    });
  }
  return { version: 1, width, height, polygons };
}
