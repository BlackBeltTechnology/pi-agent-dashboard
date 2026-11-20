// Mock-only prototype of the proposed Skill Atlas graph.
// - One persistent d3-force simulation. First layout is pre-ticked off-screen (no fly-in),
//   then the sim switches to HIGH DAMPING so anything the user sees move is slow.
// - Standard d3 drag: start -> alphaTarget(0.3).restart(), pin fx/fy to the cursor;
//   neighbours follow through link forces; end -> alphaTarget(0), unpin, settles naturally.
// - Forests = connected components over the VISIBLE links, wrapped in an aura; a custom
//   forestCollide force keeps auras apart (also while dragging). Click aura -> zoom to it.
// - Labels: 4-anchor greedy placement, never overlapping labels, dots or the frame.
// Reference prototype; not shipped. See change: add-skill-atlas-forest-aura.
import { RELATION_STYLE } from "@atlas/client/relation-style.ts";
import type { SkillLink, SkillNode, SkillOrigin } from "@atlas/shared/types.ts";
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
import { useEffect, useMemo, useRef, useState } from "react";

type N = SimulationNodeDatum & { id: string; degree: number };
type L = SimulationLinkDatum<N> & { type: SkillLink["type"] };
type P = { x: number; y: number };
interface View { k: number; x: number; y: number }

/** High damping for every visible motion (d3 default velocityDecay is 0.4). */
const DAMPING = 0.72;
const radius = (d: number) => 3.5 + Math.min(4, Math.sqrt(d) * 0.9);
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function seeded(seed = 1337) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function tween(ms: number, step: (e: number) => void): () => void {
  if (reduceMotion()) {
    step(1);
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    step(1 - (1 - t) ** 3);
    if (t < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// ---- label placement: 4 anchors per dot, never overlapping labels, dots or the frame ----
type Box = { x: number; y: number; w: number; h: number };
const LABEL_H = 14;
let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
function textWidth(s: string): number {
  let w = widthCache.get(s);
  if (w !== undefined) return w;
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (measureCtx) measureCtx.font = "11px system-ui, -apple-system, sans-serif";
  }
  w = (measureCtx ? measureCtx.measureText(s).width : s.length * 6.3) + 2;
  widthCache.set(s, w);
  return w;
}
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function placeLabels(cands: ReadonlyArray<{ id: string; x: number; y: number; r: number }>, dots: readonly Box[], frame: Box): Map<string, Box> {
  const out = new Map<string, Box>();
  const placed: Box[] = [];
  for (const c of cands) {
    const w = textWidth(c.id);
    const g = c.r + 4;
    const anchors: Box[] = [
      { x: c.x + g, y: c.y - LABEL_H / 2, w, h: LABEL_H },
      { x: c.x - g - w, y: c.y - LABEL_H / 2, w, h: LABEL_H },
      { x: c.x - w / 2, y: c.y + g, w, h: LABEL_H },
      { x: c.x - w / 2, y: c.y - g - LABEL_H, w, h: LABEL_H },
    ];
    const ok = anchors.find(
      (b) =>
        b.x >= frame.x && b.y >= frame.y && b.x + b.w <= frame.x + frame.w && b.y + b.h <= frame.y + frame.h &&
        !placed.some((p) => hit(b, p)) && !dots.some((d) => hit(b, d)),
    );
    if (ok) {
      placed.push(ok);
      out.set(c.id, ok);
    }
  }
  return out;
}

/** Convex hull (monotone chain). Returns >= 1 point; collinear sets collapse to 2. */
function hull(pts: readonly P[]): P[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length < 3) return s;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: P[] = [];
  for (const p of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up: P[] = [];
  for (const p of [...s].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** SVG path of the hull grown by `pad` with round corners: follows the graph outline. */
function outlinePath(pts: readonly P[], pad: number): string {
  const h = hull(pts);
  if (h.length === 1) {
    const { x, y } = h[0];
    return `M${x - pad},${y} a${pad},${pad} 0 1 0 ${2 * pad},0 a${pad},${pad} 0 1 0 ${-2 * pad},0Z`;
  }
  let area = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1; // SVG coords: area>0 = clockwise on screen
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

/** Connected components (forests) over the given links; largest first. */
export function forests(ids: readonly string[], links: readonly SkillLink[]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a: string): string => {
    const p = parent.get(a)!;
    if (p === a) return a;
    const r = find(p);
    parent.set(a, r);
    return r;
  };
  for (const l of links) if (parent.has(l.source) && parent.has(l.target)) parent.set(find(l.source), find(l.target));
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()].sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

/** Custom force: forests (2+ nodes) repel as discs so their auras never overlap. */
function forestCollide(groups: N[][], pad = 30) {
  return (alpha: number) => {
    const discs = groups
      .filter((g) => g.length > 1)
      .map((g) => {
        const cx = g.reduce((a, n) => a + (n.x ?? 0), 0) / g.length;
        const cy = g.reduce((a, n) => a + (n.y ?? 0), 0) / g.length;
        const r = Math.max(...g.map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy))) + pad;
        return { g, cx, cy, r };
      });
    for (let i = 0; i < discs.length; i++)
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i];
        const b = discs[j];
        const dx = b.cx - a.cx || 0.01;
        const dy = b.cy - a.cy;
        const d = Math.hypot(dx, dy);
        const overlap = a.r + b.r - d;
        if (overlap <= 0) continue;
        const push = (overlap / d) * alpha * 0.5;
        for (const n of a.g) (n.vx = (n.vx ?? 0) - dx * push), (n.vy = (n.vy ?? 0) - dy * push);
        for (const n of b.g) (n.vx = (n.vx ?? 0) + dx * push), (n.vy = (n.vy ?? 0) + dy * push);
      }
  };
}

/** (Re)apply relation-dependent forces for the visible links + forests. */
function applyForces(sim: Simulation<N, L>, nodes: readonly N[], links: readonly SkillLink[], groups: string[][]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  sim
    .force("link", forceLink<N, L>(links.map((l) => ({ source: l.source, target: l.target, type: l.type }))).id((d) => d.id).distance((l) => (l.type === "bundle" ? 70 : 55)).strength((l) => (l.type === "references" ? 0.7 : l.type === "bundle" ? 0.25 : 0.4)))
    .force("forests", forestCollide(groups.map((g) => g.map((id) => byId.get(id)!))));
}

function Dot({ origin, r }: { origin: SkillOrigin; r: number }) {
  return (
    <>
      <circle r={r + 6} fill="transparent" />
      {/* Same outline for every origin; the INSIDE differs (non-colour cue): global empty, package pip, project inner ring. */}
      <circle r={r} fill="var(--bg-primary)" stroke="var(--text-secondary)" strokeWidth={1.5} className="fg-dot" />
      {origin === "package" ? <circle r={Math.max(1.4, r * 0.32)} fill="var(--text-secondary)" /> : null}
      {origin === "project" ? <circle r={Math.max(1.6, r * 0.45)} fill="none" stroke="var(--accent-green)" strokeWidth={1.4} /> : null}
    </>
  );
}

export interface ForestGraphProps {
  skills: readonly SkillNode[];
  links: readonly SkillLink[];
  /** Relation types shown (forests are recomputed from these). */
  relations?: ReadonlyArray<SkillLink["type"]>;
  /** Start zoomed into the forest containing this skill (drawn step states). */
  initialForestOf?: string;
  height?: number;
}

const ALL_RELATIONS: ReadonlyArray<SkillLink["type"]> = ["references", "bundle", "shares-tool"];

export function ForestGraph({ skills, links, relations = ALL_RELATIONS, initialForestOf, height = 600 }: ForestGraphProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: height });
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverForest, setHoverForest] = useState<number | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [userView, setUserView] = useState<View | null>(null); // null = auto-fit
  const [, setFrame] = useState(0); // bumped on every sim tick

  // Key on the relation SET, not array identity (a fresh array per render would re-layout every render).
  const relKey = [...relations].sort().join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visible = useMemo(() => links.filter((l) => relations.includes(l.type)), [links, relKey]);
  const groups = useMemo(() => forests(skills.map((s) => s.id), visible), [skills, visible]);
  const forestOf = useMemo(() => new Map(groups.flatMap((g, i) => g.map((id) => [id, i] as const))), [groups]);

  // ---- one persistent simulation ----
  const nodes = useMemo<N[]>(() => {
    const rnd = seeded();
    return skills.map((s) => ({ id: s.id, degree: s.degree, x: rnd() * 600 - 300, y: rnd() * 400 - 200 }));
  }, [skills]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const simRef = useRef<Simulation<N, L> | null>(null);

  useEffect(() => {
    const sim = forceSimulation(nodes)
      .randomSource(seeded(7))
      .force("charge", forceManyBody().strength(-110))
      .force("collide", forceCollide<N>((d) => radius(d.degree) + 6))
      .force("x", forceX(0).strength(0.05))
      .force("y", forceY(0).strength(0.07))
      .stop();
    simRef.current = sim;
    sim.on("tick", () => setFrame((f) => f + 1));
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes]);

  // Relation/forest change: first time pre-tick off-screen; later re-settle visibly (damped).
  const settled = useRef(false);
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    applyForces(sim, nodes, visible, groups);
    if (!settled.current) {
      sim.velocityDecay(0.4).alpha(1).tick(300); // full energy, invisible
      sim.velocityDecay(DAMPING);
      settled.current = true;
      setFrame((f) => f + 1);
    } else sim.alpha(0.35).restart();
  }, [nodes, visible, groups]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Aura discs in model space (recomputed per tick; cheap at this size).
  const discs = groups.map((g) => {
    const ps = g.map((id) => byId.get(id)!);
    const cx = ps.reduce((a, p) => a + (p.x ?? 0), 0) / ps.length;
    const cy = ps.reduce((a, p) => a + (p.y ?? 0), 0) / ps.length;
    const r = g.length > 1 ? Math.max(...ps.map((p) => Math.hypot((p.x ?? 0) - cx, (p.y ?? 0) - cy))) : 0;
    return { cx, cy, r, n: g.length };
  });

  const fitTo = (idxs: readonly number[], pad = 24): View => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of idxs) {
      const d = discs[i];
      const r = d.n > 1 ? d.r + 14 : 8;
      minX = Math.min(minX, d.cx - r);
      maxX = Math.max(maxX, d.cx + r);
      minY = Math.min(minY, d.cy - r);
      maxY = Math.max(maxY, d.cy + r);
    }
    const k = Math.min((size.w - 2 * pad) / Math.max(1, maxX - minX), (size.h - 2 * pad) / Math.max(1, maxY - minY), 3);
    return { k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k };
  };

  // Auto-fit is frozen while dragging so the camera doesn't chase the dragged node.
  const press = useRef<{ x: number; y: number; view: View; node?: N } | null>(null);
  const frozenFit = useRef<View | null>(null);
  const autoFit = frozenFit.current ?? fitTo(discs.map((_, i) => i));
  const v = userView ?? autoFit;
  const vRef = useRef(v);
  vRef.current = v;

  const animateView = (target: View | null) => {
    const from = vRef.current;
    const to = target ?? fitTo(discs.map((_, i) => i));
    tween(380, (e) => setUserView(e === 1 && !target ? null : { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }));
  };
  const zoomForest = (i: number | null) => {
    setActive(i);
    animateView(i === null ? null : fitTo([i]));
  };

  useEffect(() => {
    if (initialForestOf && forestOf.has(initialForestOf)) {
      const i = forestOf.get(initialForestOf)!;
      setActive(i);
      setUserView(fitTo([i]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialForestOf, size.w, forestOf]);

  const at = (id: string): P => {
    const n = byId.get(id)!;
    return { x: (n.x ?? 0) * v.k + v.x, y: (n.y ?? 0) * v.k + v.y };
  };
  const toModel = (clientX: number, clientY: number): P => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  // ---- pointer: standard d3 drag semantics; pan on background; rAF-batched ----
  const pending = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const flush = () => {
    raf.current = 0;
    const p = press.current;
    const m = pending.current;
    if (!p || !m) return;
    if (p.node) {
      const q = toModel(m.x, m.y);
      p.node.fx = q.x; // pinned to cursor; sim pulls neighbours along
      p.node.fy = q.y;
    } else setUserView({ ...p.view, x: p.view.x + m.x - p.x, y: p.view.y + m.y - p.y });
  };
  const onDown = (e: React.PointerEvent, node?: N) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, view: v, node };
    if (node) {
      frozenFit.current = v;
      node.fx = node.x;
      node.fy = node.y;
      simRef.current?.alphaTarget(0.3).restart(); // drag start
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!press.current) return;
    pending.current = { x: e.clientX, y: e.clientY };
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };
  const onUp = (e: React.PointerEvent, click: () => void) => {
    e.stopPropagation();
    const p = press.current;
    press.current = null;
    pending.current = null;
    if (raf.current) cancelAnimationFrame(raf.current), (raf.current = 0);
    if (p?.node) {
      simRef.current?.alphaTarget(0); // drag end: cool down
      p.node.fx = null; // unpin -> settles naturally (damped)
      p.node.fy = null;
      if (!userView) setUserView(frozenFit.current); // keep camera where it was
      frozenFit.current = null;
    }
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) click();
  };

  function dim(id: string) {
    return active !== null && forestOf.get(id) !== active;
  }
  const top = useMemo(() => new Set([...skills].sort((a, b) => b.degree - a.degree).slice(0, 8).map((s) => s.id)), [skills]);
  const wantLabel = (id: string) => id === selected || hoverNode === id || (active !== null ? forestOf.get(id) === active : top.has(id));
  const rank = (s: SkillNode) => (s.id === hoverNode ? 0 : s.id === selected ? 1 : 2);
  const labels = placeLabels(
    skills
      .filter((s) => wantLabel(s.id))
      .sort((a, b) => rank(a) - rank(b) || b.degree - a.degree || (a.id < b.id ? -1 : 1))
      .map((s) => ({ id: s.id, ...at(s.id), r: radius(s.degree) })),
    skills.filter((s) => !dim(s.id)).map((s) => {
      const p = at(s.id);
      const r = radius(s.degree) + 1.5;
      return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
    }),
    { x: 2, y: 2, w: size.w - 4, h: size.h - 4 },
  );
  const auraOrder = discs.map((d, i) => ({ ...d, i })).filter((d) => d.n > 1).sort((a, b) => b.r - a.r);

  return (
    <div ref={wrap} className="relative w-full overflow-hidden bg-[var(--bg-primary)]" style={{ height }}>
      <svg
        className="block h-full w-full touch-none cursor-grab"
        style={{ visibility: settled.current ? "visible" : "hidden" }}
        tabIndex={0}
        role="img"
        aria-label={`Skill graph, ${skills.length} skills in ${auraOrder.length} groups. Click a group's halo to zoom in, Escape to zoom out.`}
        onKeyDown={(e) => e.key === "Escape" && zoomForest(null)}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e, () => (active !== null ? zoomForest(null) : setSelected(null)))}
        onWheel={(e) => {
          const f = e.deltaY < 0 ? 1.1 : 0.9;
          const ox = e.nativeEvent.offsetX;
          const oy = e.nativeEvent.offsetY;
          setUserView({ k: v.k * f, x: ox - (ox - v.x) * f, y: oy - (oy - v.y) * f });
        }}
      >
        <defs>
          <marker id="fg-arrow" viewBox="0 0 10 10" refX="13" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent-blue)" />
          </marker>
          <radialGradient id="fg-aura">
            <stop offset="55%" stopColor="var(--accent-blue)" stopOpacity={0.02} />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0.12} />
          </radialGradient>
        </defs>
        <g>
          {auraOrder.map((a) => {
            const on = a.i === active;
            const hot = a.i === hoverForest;
            return (
              <path
                key={a.i}
                d={outlinePath(groups[a.i].map(at), 20)}
                strokeLinejoin="round"
                fill="url(#fg-aura)"
                stroke="var(--accent-blue)"
                strokeOpacity={on ? 0.7 : hot ? 0.55 : 0.22}
                strokeWidth={on ? 2 : 1.25}
                strokeDasharray={on ? undefined : "4 5"}
                opacity={active !== null && !on ? 0.25 : 1}
                className="cursor-zoom-in"
                onPointerEnter={() => setHoverForest(a.i)}
                onPointerLeave={() => setHoverForest(null)}
                onPointerDown={(e) => onDown(e)}
                onPointerUp={(e) => onUp(e, () => zoomForest(on ? null : a.i))}
              >
                <title>{`${a.n} skills, click to zoom`}</title>
              </path>
            );
          })}
        </g>
        <g className="pointer-events-none">
          {visible.map((l) => {
            const a = at(l.source);
            const b = at(l.target);
            const s = RELATION_STYLE[l.type];
            return (
              <line
                key={`${l.source}|${l.target}|${l.type}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={s.color}
                strokeDasharray={s.dash}
                strokeWidth={1.4}
                opacity={dim(l.source) ? 0.08 : 0.7}
                markerEnd={l.type === "references" ? "url(#fg-arrow)" : undefined}
              />
            );
          })}
        </g>
        <g>
          {skills.map((s) => {
            const p = at(s.id);
            const sel = s.id === selected;
            return (
              <g
                key={s.id}
                transform={`translate(${p.x},${p.y})`}
                opacity={dim(s.id) ? 0.15 : 1}
                className={`cursor-pointer ${sel ? "[&_.fg-dot]:stroke-[var(--focus-ring)] [&_.fg-dot]:[stroke-width:3]" : ""}`}
                onPointerEnter={() => setHoverNode(s.id)}
                onPointerLeave={() => setHoverNode(null)}
                onPointerDown={(e) => onDown(e, byId.get(s.id))}
                onPointerUp={(e) => onUp(e, () => setSelected(sel ? null : s.id))}
              >
                <Dot origin={s.origin} r={radius(s.degree)} />
                <title>{s.id}</title>
              </g>
            );
          })}
        </g>
        <g className="pointer-events-none" aria-hidden="true">
          {skills.filter((s) => labels.has(s.id)).map((s) => {
            const b = labels.get(s.id)!;
            return (
              <text key={s.id} x={b.x + 1} y={b.y + 11} fontSize={11} fontFamily="system-ui, -apple-system, sans-serif" fill={s.id === selected ? "var(--text-primary)" : "var(--text-secondary)"} stroke="var(--bg-primary)" strokeWidth={3} paintOrder="stroke">
                {s.id}
              </text>
            );
          })}
        </g>
      </svg>
      {active !== null ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
          <span>
            Group: <b className="text-[var(--text-primary)]">{groups[active].length} skills</b>
          </span>
          <button type="button" className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" onClick={() => zoomForest(null)}>
            Show all (Esc)
          </button>
        </div>
      ) : null}
    </div>
  );
}
