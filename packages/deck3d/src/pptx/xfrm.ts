/**
 * EMU → slide space, and group transform composition (design D1 `xfrm.ts`).
 *
 * A child of `p:grpSp` lives in the group's child space (`chOff`/`chExt`).
 * Mapping it into the parent: scale by `ext/chExt` about `chOff`→`off`, then
 * mirror its centre about the group centre for each group flip, then rotate
 * its centre about the group centre by the group rotation. The child's own
 * rotation is negated by an odd number of flips, then adds the group's; its
 * flips toggle with the group's. Frames nest, so groups of groups compose.
 */
import type { Rect } from "./types.js";
import { child, num, type XNode } from "./xml.js";

export interface Placed {
  /** EMU in the parent space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise. */
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

export type Frame = (p: Placed) => Placed;

export const IDENTITY: Frame = (p) => p;

/** Read `a:xfrm` (or `p:xfrm`) of a shape. Undefined when it carries no `a:off`. */
export function readXfrm(xfrm: XNode | undefined): Placed | undefined {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!xfrm || !off || !ext) return undefined;
  return {
    x: num(off.attrs.x),
    y: num(off.attrs.y),
    w: num(ext.attrs.cx),
    h: num(ext.attrs.cy),
    rot: num(xfrm.attrs.rot) / 60000,
    flipH: xfrm.attrs.flipH === "1" || xfrm.attrs.flipH === "true",
    flipV: xfrm.attrs.flipV === "1" || xfrm.attrs.flipV === "true",
  };
}

function rotateAbout(px: number, py: number, cx: number, cy: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  // Clockwise in a y-down space.
  return [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)];
}

/** Frame for the children of a group whose `a:xfrm` is `xfrm`, nested in `parent`. */
export function groupFrame(xfrm: XNode | undefined, parent: Frame): Frame {
  const g = readXfrm(xfrm);
  if (!g) return parent;
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  const cox = num(chOff?.attrs.x, g.x);
  const coy = num(chOff?.attrs.y, g.y);
  const cw = num(chExt?.attrs.cx, g.w) || g.w || 1;
  const ch = num(chExt?.attrs.cy, g.h) || g.h || 1;
  const sx = g.w / cw;
  const sy = g.h / ch;
  const gcx = g.x + g.w / 2;
  const gcy = g.y + g.h / 2;
  return (p) => {
    const w = p.w * sx;
    const h = p.h * sy;
    let cx = g.x + (p.x + p.w / 2 - cox) * sx;
    let cy = g.y + (p.y + p.h / 2 - coy) * sy;
    if (g.flipH) cx = 2 * gcx - cx;
    if (g.flipV) cy = 2 * gcy - cy;
    [cx, cy] = rotateAbout(cx, cy, gcx, gcy, g.rot);
    const odd = g.flipH !== g.flipV;
    const rot = (odd ? -p.rot : p.rot) + g.rot;
    return parent({ x: cx - w / 2, y: cy - h / 2, w, h, rot, flipH: p.flipH !== g.flipH, flipV: p.flipV !== g.flipV });
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Normalise degrees into [0, 360). */
export function normDeg(d: number): number {
  const r = ((d % 360) + 360) % 360;
  return round2(r === 360 ? 0 : r);
}

/** EMU rect → slide-space rect (rounded to 0.01 for byte-stable JSON). */
export function toSlide(p: Placed, scale: number): Rect {
  return { x: round2(p.x * scale), y: round2(p.y * scale), w: round2(p.w * scale), h: round2(p.h * scale) };
}
