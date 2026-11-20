/**
 * Stateful d3-force simulation for the atlas graph (design D1, D3, D7).
 *
 * - `createAtlasSimulation`: STOPPED, seeded simulation over every skill of
 *   the graph; link + `forestSeparation` forces follow the relation-visible
 *   links (`setRelationForces`). Surviving ids may start from `prev`.
 * - `presettle`: synchronous, invisible settle (velocityDecay 0.4, ≤ 220-tick
 *   cooling, then extra ticks until forest discs are disjoint, ≤ 60), then
 *   switches to the heavy damping (0.72) used for all visible motion.
 * - `forestDiscs` / `discsDisjoint`: the separation geometry (centroid, max
 *   node distance + node radius + OUTLINE_PAD) — disc ⊇ outline.
 * - `dragStart` / `dragMove` / `dragEnd`: standard d3 drag semantics.
 * See change: add-skill-atlas-forest-aura.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { SkillLink, SkillNode } from "../shared/types.js";
import { forests, nodeRadius, OUTLINE_PAD, type Point } from "./graph-layout.js";

export type SimNode = SimulationNodeDatum & { id: string; r: number };
type SimLink = SimulationLinkDatum<SimNode> & { type: SkillLink["type"] };
export type AtlasSimulation = Simulation<SimNode, SimLink>;

/** Velocity decay for every visible motion (d3 default is 0.4). */
const DAMPING = 0.72;
/** Pre-settle cooling budget: alphaDecay chosen so alpha reaches alphaMin within this many ticks. */
const PRESETTLE_TICKS = 220;
const EXTRA_TICKS = 60;
/** Gap kept between forest discs on top of the outline pad. */
const DISC_GAP = 4;
const DEFAULT_ALPHA_DECAY = 1 - 0.001 ** (1 / 300);

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LINK_DISTANCE: Record<SkillLink["type"], number> = { references: 55, bundle: 70, "shares-tool": 55 };
const LINK_STRENGTH: Record<SkillLink["type"], number> = { references: 0.7, bundle: 0.25, "shares-tool": 0.4 };

export interface Disc {
  nodes: SimNode[];
  cx: number;
  cy: number;
  r: number;
}

/** Separation discs of every forest with ≥ 2 nodes. */
export function forestDiscs(groups: readonly (readonly SimNode[])[], pad = OUTLINE_PAD): Disc[] {
  const out: Disc[] = [];
  for (const g of groups) {
    if (g.length < 2) continue;
    let cx = 0;
    let cy = 0;
    for (const n of g) {
      cx += n.x ?? 0;
      cy += n.y ?? 0;
    }
    cx /= g.length;
    cy /= g.length;
    let r = 0;
    for (const n of g) r = Math.max(r, Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy) + n.r);
    out.push({ nodes: g as SimNode[], cx, cy, r: r + pad });
  }
  return out;
}

export function discsDisjoint(discs: readonly Disc[], gap = 0): boolean {
  for (let i = 0; i < discs.length; i++)
    for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i];
      const b = discs[j];
      if (Math.hypot(b.cx - a.cx, b.cy - a.cy) < a.r + b.r + gap) return false;
    }
  return true;
}

/**
 * Custom force: forests (≥ 2 nodes) repel as discs so their outlines never
 * overlap. Position-based like `forceCollide` (overlap × strength, not scaled
 * by alpha), so it still separates during the at-alphaMin extra ticks of
 * `presettle`. Pinned nodes (`fx != null`) are skipped: a dragged node stays
 * under the pointer. O(F² + n) per tick.
 */
function forestSeparation(groups: readonly (readonly SimNode[])[], strength = 0.35) {
  return () => {
    const discs = forestDiscs(groups);
    for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) pushApart(discs[i], discs[j], strength);
  };
}

/** Add velocity moving two overlapping discs apart along their centre line (pinned nodes skipped). */
function pushApart(a: Disc, b: Disc, strength: number): void {
  const raw = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  const [dx, dy, d] = raw < 1e-6 ? [0.01, 0, 0.01] : [b.cx - a.cx, b.cy - a.cy, raw];
  const overlap = a.r + b.r + DISC_GAP - d;
  if (overlap <= 0) return;
  const push = ((overlap / d) * strength) / 2;
  nudge(a.nodes, -dx * push, -dy * push);
  nudge(b.nodes, dx * push, dy * push);
}

function nudge(nodes: readonly SimNode[], vx: number, vy: number): void {
  for (const n of nodes) {
    if (n.fx != null) continue;
    n.vx = (n.vx ?? 0) + vx;
    n.vy = (n.vy ?? 0) + vy;
  }
}

const GROUPS = new WeakMap<AtlasSimulation, SimNode[][]>();

/** (Re)apply the relation-dependent forces: links + forest separation over `links`. */
export function setRelationForces(sim: AtlasSimulation, links: readonly SkillLink[]): void {
  const nodes = sim.nodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map((l) => ({ source: l.source, target: l.target, type: l.type }));
  const groups = forests(
    nodes.map((n) => n.id),
    links,
  ).map((g) => g.map((id) => byId.get(id) as SimNode));
  sim
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => LINK_DISTANCE[l.type])
        .strength((l) => LINK_STRENGTH[l.type]),
    )
    .force("forests", forestSeparation(groups));
  GROUPS.set(sim, groups);
}

/** Current simulation forests (as set by the last `setRelationForces`). */
function simulationForests(sim: AtlasSimulation): SimNode[][] {
  return GROUPS.get(sim) ?? [];
}

export interface CreateAtlasSimulationOptions {
  skills: readonly SkillNode[];
  /** Relation-visible links (all origins). */
  links: readonly SkillLink[];
  /** Previous positions of surviving ids (live update). */
  prev?: ReadonlyMap<string, Point>;
}

/** Build a STOPPED, seeded simulation. Same input → same result after `presettle`. */
export function createAtlasSimulation({ skills, links, prev }: CreateAtlasSimulationOptions): AtlasSimulation {
  const rnd = seeded(1337);
  const nodes: SimNode[] = skills.map((s) => {
    const x = rnd() * 600 - 300;
    const y = rnd() * 400 - 200;
    const p = prev?.get(s.id);
    return { id: s.id, r: nodeRadius(s.degree), x: p?.x ?? x, y: p?.y ?? y };
  });
  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .stop()
    .randomSource(seeded(7))
    .force("charge", forceManyBody<SimNode>().strength(-110))
    .force(
      "collide",
      forceCollide<SimNode>((d) => d.r + 6),
    )
    .force("x", forceX<SimNode>(0).strength(0.05))
    .force("y", forceY<SimNode>(0).strength(0.07));
  setRelationForces(sim, links);
  return sim;
}

/**
 * Settle synchronously (no tick events, nothing rendered): velocityDecay 0.4
 * from `alpha` until at rest (≤ PRESETTLE_TICKS), extra ticks at alphaMin
 * until forest discs are disjoint (≤ 60), then DAMPING for visible motion.
 */
export function presettle(sim: AtlasSimulation, alpha = 1): void {
  const min = sim.alphaMin();
  sim.stop();
  sim
    .velocityDecay(0.4)
    .alphaTarget(0)
    .alpha(alpha)
    .alphaDecay(1 - (min / alpha) ** (1 / PRESETTLE_TICKS));
  while (sim.alpha() >= min) sim.tick();
  const groups = simulationForests(sim);
  for (let i = 0; i < EXTRA_TICKS && !discsDisjoint(forestDiscs(groups)); i++) sim.tick();
  for (const n of sim.nodes()) {
    n.vx = 0;
    n.vy = 0;
  }
  sim.alphaDecay(DEFAULT_ALPHA_DECAY).velocityDecay(DAMPING);
}

/** Pin `node` at its position and heat the simulation (d3 drag start). */
export function dragStart(sim: AtlasSimulation, node: SimNode): void {
  node.fx = node.x;
  node.fy = node.y;
  sim.alphaTarget(0.3).restart();
}

/** Move the pinned node to the pointer (model space). */
export function dragMove(node: SimNode, p: Point): void {
  node.fx = p.x;
  node.fy = p.y;
}

/** Unpin and cool down: the node drifts into place (damped). */
export function dragEnd(sim: AtlasSimulation, node: SimNode): void {
  node.fx = null;
  node.fy = null;
  sim.alphaTarget(0);
}
