/**
 * Pure graph helpers for the atlas client (no React, no DOM except the cached
 * canvas text measure, which falls back to an estimate).
 *
 * - `nodeRadius`: dot radius by degree, `max(5, 4 + √degree)` capped at 9.
 * - `forests`: connected components over the given links, largest first.
 * - `hull` + `outlinePath`: padded, rounded convex-hull outline (SVG path).
 * - `boundsOf` + `fitView`: camera `{k,x,y}` (screen = model·k + (x,y)) fitting
 *   a model-space box into a viewport, scale capped by `kMax`.
 * - `placeLabels`: four-anchor greedy placement (right, left, below, above),
 *   never overlapping labels, nodes or the frame; hovered then selected first.
 * - `hopSet`, `neighbourRows`, `topByDegree`: selection helpers.
 * The stateful d3-force simulation lives in `atlas-simulation.ts`.
 * See change: add-skill-atlas-screen, add-skill-atlas-forest-aura (D2–D5, D9, D11).
 */
import type { SkillLink, SkillNode } from "../shared/types.js";
export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** Camera: screen = model · k + (x, y). */
export interface View {
  k: number;
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Outline padding around a forest's node centres (px, model space). */
export const OUTLINE_PAD = 20;

/** Dot radius: `max(5, 4 + √degree)`, capped at 9 (design D11). */
export const nodeRadius = (degree: number): number => Math.min(9, Math.max(5, 4 + Math.sqrt(degree)));

/** Connected components (forests) over `links` restricted to `ids`; largest first, ties by first id. */
export function forests(ids: readonly string[], links: readonly SkillLink[]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    let c = a;
    while (c !== r) {
      const next = parent.get(c) as string;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const l of links) {
    if (!parent.has(l.source) || !parent.has(l.target)) continue;
    const a = find(l.source);
    const b = find(l.target);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    const g = groups.get(r);
    if (g) g.push(id);
    else groups.set(r, [id]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

/** Convex hull (monotone chain). Returns ≥ 1 point; a collinear set collapses to its 2 endpoints. */
function hull(pts: readonly Point[]): Point[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length < 3) return s;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Point[] = [];
  for (const p of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up: Point[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  return h.length ? h : [s[0]];
}

/** SVG path of the hull grown by `pad` with round joins: 1 point → circle, 2 → capsule. */
export function outlinePath(pts: readonly Point[], pad: number): string {
  const h = hull(pts);
  if (!h.length) return "";
  if (h.length === 1 || (h.length === 2 && h[0].x === h[1].x && h[0].y === h[1].y)) {
    const { x, y } = h[0];
    return `M${x - pad},${y} A${pad},${pad} 0 1 0 ${x + pad},${y} A${pad},${pad} 0 1 0 ${x - pad},${y}Z`;
  }
  let area = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1; // 2-point hull: area 0 → treated as one orientation
  const off = h.map((a, i) => {
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (sign * (b.y - a.y)) / len;
    const ny = (sign * -(b.x - a.x)) / len;
    return { s: { x: a.x + nx * pad, y: a.y + ny * pad }, e: { x: b.x + nx * pad, y: b.y + ny * pad } };
  });
  const sweep = sign > 0 ? 1 : 0;
  let d = `M${off[0].s.x},${off[0].s.y}`;
  for (let i = 0; i < off.length; i++) {
    const next = off[(i + 1) % off.length];
    d += ` L${off[i].e.x},${off[i].e.y} A${pad},${pad} 0 0 ${sweep} ${next.s.x},${next.s.y}`;
  }
  return `${d}Z`;
}

/** Model-space box around `points`, grown by `pad` (covers a forest outline when pad ≥ OUTLINE_PAD). */
export function boundsOf(points: readonly Point[], pad: number): Box {
  if (!points.length) return { x: -pad, y: -pad, w: 2 * pad, h: 2 * pad };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** Camera fitting `bounds` into `viewport` with `pad` px margin; scale capped by `kMax` (no 1–3 node blow-up). */
export function fitView(bounds: Box, viewport: Viewport, pad = 24, kMax = 3): View {
  const usableW = Math.max(1, viewport.w - 2 * pad);
  const usableH = Math.max(1, viewport.h - 2 * pad);
  const k = Math.min(usableW / Math.max(1e-3, bounds.w), usableH / Math.max(1e-3, bounds.h), kMax);
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { k, x: viewport.w / 2 - cx * k, y: viewport.h / 2 - cy * k };
}

export interface LabelCandidate {
  id: string;
  /** Node centre in screen px. */
  x: number;
  y: number;
  /** Node radius in screen px. */
  r: number;
  /** Hovered/selected labels are placed first and may cover a node when no side is free. */
  hovered?: boolean;
  selected?: boolean;
}

export const LABEL_H = 14;
const LABEL_FONT = "11px system-ui, -apple-system, sans-serif";
let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

/** Rendered label width (cached canvas measure at 11 px system-ui; 6.3 px/char fallback) + 2 px. */
function labelWidth(s: string): number {
  const cached = widthCache.get(s);
  if (cached !== undefined) return cached;
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      measureCtx = null;
    }
    if (measureCtx) measureCtx.font = LABEL_FONT;
  }
  const w = (measureCtx ? measureCtx.measureText(s).width : s.length * 6.3) + 2;
  widthCache.set(s, w);
  return w;
}

const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box, f: Box) => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h;

/**
 * Four-anchor greedy label placement (design D9). `candidates` are taken in
 * order after hovered, then selected, are moved to the front. Each tries
 * right, left, below, above and takes the first anchor inside `frame` clear
 * of placed labels and of every box in `nodes`; otherwise it is hidden.
 * Hovered/selected fall back to the first in-frame anchor clear of placed
 * labels (may cover a node); the hovered label is clamped into the frame as a
 * last resort, so it always shows. Returns id → label box (screen px).
 */
export function placeLabels(candidates: readonly LabelCandidate[], nodes: readonly Box[], frame: Box): Map<string, Box> {
  const rank = (c: LabelCandidate) => (c.hovered ? 0 : c.selected ? 1 : 2);
  const order = candidates.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  const out = new Map<string, Box>();
  const placed: Box[] = [];
  for (const { c } of order) {
    if (out.has(c.id)) continue;
    const box = placeOne(c, labelAnchors(c, labelWidth(c.id)), nodes, placed, frame);
    if (!box) continue;
    placed.push(box);
    out.set(c.id, box);
  }
  return out;
}

/** Right, left, below, above. */
function labelAnchors(c: LabelCandidate, w: number): Box[] {
  const g = c.r + 4;
  return [
    { x: c.x + g, y: c.y - LABEL_H / 2, w, h: LABEL_H },
    { x: c.x - g - w, y: c.y - LABEL_H / 2, w, h: LABEL_H },
    { x: c.x - w / 2, y: c.y + g, w, h: LABEL_H },
    { x: c.x - w / 2, y: c.y - g - LABEL_H, w, h: LABEL_H },
  ];
}

function placeOne(c: LabelCandidate, anchors: Box[], nodes: readonly Box[], placed: readonly Box[], frame: Box): Box | undefined {
  const clearOfLabels = (b: Box) => inside(b, frame) && !placed.some((p) => hit(b, p));
  const free = anchors.find((b) => clearOfLabels(b) && !nodes.some((n) => hit(b, n)));
  if (free) return free;
  const priority = c.hovered || c.selected ? anchors.find(clearOfLabels) : undefined;
  if (priority || !c.hovered) return priority;
  const a = anchors[0];
  return {
    ...a,
    x: Math.max(frame.x, Math.min(a.x, frame.x + frame.w - a.w)),
    y: Math.max(frame.y, Math.min(a.y, frame.y + frame.h - a.h)),
  };
}

/** Ids within `hops` links of `id` (undirected), including `id`. */
export function hopSet(links: readonly SkillLink[], id: string, hops: number): Set<string> {
  const set = new Set([id]);
  let frontier = new Set([id]);
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const l of links) {
      if (frontier.has(l.source) && !set.has(l.target)) next.add(l.target);
      if (frontier.has(l.target) && !set.has(l.source)) next.add(l.source);
    }
    for (const n of next) set.add(n);
    frontier = next;
  }
  return set;
}

export interface NeighbourRow {
  id: string;
  /** `→` this skill names it, `←` it names this skill, `↔` both; empty for undirected types. */
  direction: "→" | "←" | "↔" | "";
  why: string;
}

/** One row per neighbour for a link type; mutual references merge into `↔`. */
export function neighbourRows(id: string, links: readonly SkillLink[], type: SkillLink["type"]): NeighbourRow[] {
  const rows = new Map<string, NeighbourRow>();
  for (const l of links) {
    if (l.type !== type || (l.source !== id && l.target !== id)) continue;
    const other = l.source === id ? l.target : l.source;
    const dir = type === "references" ? (l.source === id ? "→" : "←") : "";
    const existing = rows.get(other);
    if (existing && type === "references" && existing.direction !== dir) {
      existing.direction = "↔";
      existing.why = `${id} and ${other} name each other in their SKILL.md`;
    } else if (!existing) {
      rows.set(other, { id: other, direction: dir, why: l.why });
    }
  }
  return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Top `n` skills by degree; ties by id. Zero-degree skills excluded. */
export function topByDegree(skills: readonly SkillNode[], n: number): SkillNode[] {
  return [...skills]
    .filter((s) => s.degree > 0)
    .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1))
    .slice(0, n);
}
