/**
 * Pure graph helpers for the atlas client (no React, no DOM).
 *
 * - `layoutGraph`: seeded force layout in NORMALIZED model space [0,1]²,
 *   deterministic per graph (same nodes + links → same positions).
 * - `fitTransform`: scale model points into a viewport, fitted to a subset
 *   (focus re-fit), with zoom + pan.
 * - `placeLabels`: greedy, priority-ordered, overlap-free label placement.
 * - `hopSet`, `neighbourRows`, `topByDegree`: selection helpers.
 * See change: add-skill-atlas-screen (design D9).
 */
import type { SkillLink, SkillNode } from "../shared/types.js";

export interface Point {
  x: number;
  y: number;
}

const ITERATIONS = 300;

/** Deterministic force layout → positions normalized into [0,1]². */
export function layoutGraph(skills: readonly SkillNode[], links: readonly SkillLink[]): Map<string, Point> {
  const ids = skills.map((s) => s.id);
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = rnd() * 800 - 400;
    y[i] = rnd() * 600 - 300;
  }
  const linked = new Uint8Array(n);
  const edges = links
    .map((l) => [index.get(l.source), index.get(l.target), l.type] as const)
    .filter((e): e is readonly [number, number, SkillLink["type"]] => e[0] !== undefined && e[1] !== undefined);
  for (const [a, b] of edges) {
    linked[a] = 1;
    linked[b] = 1;
  }
  for (let it = 0; it < ITERATIONS; it++) {
    const t = 1 - it / ITERATIONS;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j];
        let dy = y[i] - y[j];
        const f = 2600 / (dx * dx + dy * dy + 0.01);
        dx *= f;
        dy *= f;
        vx[i] += dx;
        vy[i] += dy;
        vx[j] -= dx;
        vy[j] -= dy;
      }
    }
    for (const [a, b, type] of edges) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = type === "bundle" ? 110 : 95;
      const k = ((type === "references" ? 0.06 : type === "bundle" ? 0.008 : 0.03) * (d - rest)) / d;
      vx[a] += dx * k;
      vy[a] += dy * k;
      vx[b] -= dx * k;
      vy[b] -= dy * k;
    }
    for (let i = 0; i < n; i++) {
      const g = linked[i] ? 0.03 : 0.09; // isolated nodes stay near the centre
      vx[i] -= x[i] * g;
      vy[i] -= y[i] * g;
      x[i] += Math.max(-30, Math.min(30, vx[i])) * t;
      y[i] += Math.max(-30, Math.min(30, vy[i])) * t;
      vx[i] *= 0.5;
      vy[i] *= 0.5;
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    minY = Math.min(minY, y[i]);
    maxX = Math.max(maxX, x[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const out = new Map<string, Point>();
  for (let i = 0; i < n; i++) out.set(ids[i], { x: (x[i] - minX) / span, y: (y[i] - minY) / span });
  return out;
}

export interface Viewport {
  w: number;
  h: number;
}

/** Map model points to viewport pixels, fitted to `fitIds` (all when empty). */
export function fitTransform(
  points: ReadonlyMap<string, Point>,
  fitIds: readonly string[],
  viewport: Viewport,
  zoom = 1,
  pan: Point = { x: 0, y: 0 },
  pad = 80,
): (id: string) => Point {
  const subset = (fitIds.length ? fitIds : [...points.keys()]).map((id) => points.get(id)).filter((p): p is Point => !!p);
  const xs = subset.map((p) => p.x);
  const ys = subset.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const w = Math.max(1e-3, (xs.length ? Math.max(...xs) : 1) - minX);
  const h = Math.max(1e-3, (ys.length ? Math.max(...ys) : 1) - minY);
  const usableW = Math.max(1, viewport.w - 2 * pad);
  const usableH = Math.max(1, viewport.h - 2 * pad);
  // Cap the scale so a 1–3 node focus set is not blown up to the whole view.
  const scale = Math.min(usableW / w, usableH / h, Math.min(viewport.w, viewport.h) * 2.2) * zoom;
  const cx = minX + w / 2;
  const cy = minY + h / 2;
  return (id) => {
    const p = points.get(id) ?? { x: cx, y: cy };
    return { x: (p.x - cx) * scale + viewport.w / 2 + pan.x, y: (p.y - cy) * scale + viewport.h / 2 + pan.y };
  };
}

export interface LabelCandidate {
  id: string;
  x: number;
  y: number;
  /** Lower = more important. `0` is always placed. */
  priority: number;
}

/** Approximate label box (11px system font). */
export const labelBox = (c: LabelCandidate) => ({ x: c.x + 10, y: c.y - 8, w: c.id.length * 6.3 + 4, h: 15 });

/** Greedy placement: highest priority first, skip any label overlapping a placed one. */
export function placeLabels(candidates: readonly LabelCandidate[]): Set<string> {
  const placed: Array<ReturnType<typeof labelBox>> = [];
  const out = new Set<string>();
  const order = [...candidates].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  for (const c of order) {
    const b = labelBox(c);
    const hit = placed.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
    if (hit && c.priority > 0) continue;
    placed.push(b);
    out.add(c.id);
  }
  return out;
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
