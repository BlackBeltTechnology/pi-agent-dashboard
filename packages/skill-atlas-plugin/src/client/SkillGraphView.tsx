/**
 * SVG force-graph view on a persistent d3-force simulation (atlas-simulation.ts).
 *
 * - Layout: every skill of the graph × relation-visible links, pre-settled
 *   synchronously (deterministic, no fly-in); later motion is heavily damped.
 *   Relation-set change → visible re-settle (reduced motion: one step). Origin
 *   toggles only hide nodes. Refetch → new simulation seeded from survivors.
 * - Forests (connected over the drawn links) get a rounded hull outline;
 *   click an outline → zoom to it (pointer-only), Esc / "Show all" / empty
 *   click → back. A press moving ≥ 4 px pans (background, outline) or drags
 *   (node, standard d3 drag: neighbours follow, release settles).
 * - Camera `{k,x,y}`: fit once at first rest; then only Fit, focus change,
 *   forest enter/exit, or a resize while the user has not panned/zoomed.
 * - Nodes: hollow dots, origin by inner mark (Global none, Package dot,
 *   Project ring). Labels: four-anchor placement, never overlapping.
 * - Keyboard: arrows walk nodes by degree, Enter selects, Esc leaves forest
 *   zoom, then clears the selection.
 * Emits `performance.mark("atlas-graph-rendered")` after the first visible
 * paint of each mount (P4).
 * See change: add-skill-atlas-screen (ui-plan S2), add-skill-atlas-forest-aura.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiFitToScreenOutline, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SkillLink, SkillLinkType, SkillNode, SkillOrigin } from "../shared/types.js";
import {
  type AtlasSimulation,
  createAtlasSimulation,
  dragEnd,
  dragMove,
  dragStart,
  presettle,
  type SimNode,
  setRelationForces,
} from "./atlas-simulation.js";
import {
  boundsOf,
  fitView,
  forests,
  hopSet,
  type LabelCandidate,
  OUTLINE_PAD,
  outlinePath,
  type Point,
  placeLabels,
  type View,
  type Viewport,
} from "./graph-layout.js";
import { ORIGIN_STYLE, RELATION_STYLE } from "./relation-style.js";

export interface SkillGraphViewProps {
  allSkills: readonly SkillNode[];
  allLinks: readonly SkillLink[];
  /** Visible (origin-filtered) skills and relation-filtered links. */
  skills: readonly SkillNode[];
  links: readonly SkillLink[];
  /** Visible relation types: the simulation lays out all skills × these links. */
  relations: readonly SkillLinkType[];
  selected: string | null;
  hops: number;
  matches: (s: SkillNode) => boolean;
  query: string;
  onSelect: (id: string | null) => void;
  /** Test seam: receives each simulation the view creates. */
  onSimulation?: (sim: AtlasSimulation) => void;
}

/** A press moving less than this (px) is a click; at/above it pans or drags. */
const CLICK_PX = 4;
const TWEEN_MS = 380;

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Hollow dot: one outline for every origin; the inner mark tells origin apart (design D11). */
function Dot({ origin, r, hitArea = true }: { origin: SkillOrigin; r: number; hitArea?: boolean }) {
  return (
    <>
      {hitArea && <circle r={r + 6} fill="transparent" className="atlas-hit" />}
      <circle r={r} fill="var(--bg-primary)" stroke="var(--text-secondary)" strokeWidth={1.5} className="atlas-shape" />
      {origin === "package" && <circle r={Math.max(1.5, r * 0.3)} fill="var(--text-secondary)" className="atlas-mark" />}
      {origin === "project" && (
        <circle r={Math.max(3, r * 0.62)} fill="none" stroke="var(--accent-green-text)" strokeWidth={1.25} className="atlas-mark" />
      )}
    </>
  );
}

interface Press {
  /** Pointer that owns this press; other pointers are ignored until it ends. */
  pointerId: number;
  x: number;
  y: number;
  cam: View;
  kind: "bg" | "outline" | "node";
  target: string | null;
  moved: boolean;
}

interface SimHolder {
  sim: AtlasSimulation;
  /** Relation set the simulation's link/separation forces currently use. */
  rel: string;
}

export function SkillGraphView(props: SkillGraphViewProps): React.ReactElement {
  const t = useT();
  const { allSkills, allLinks, skills, links, relations, selected, hops, matches, query, onSelect, onSimulation } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<Viewport>({ w: 900, h: 600 });
  const [cam, setCam] = useState<View | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const userMoved = useRef(false);
  const [, setFrame] = useState(0);
  const bump = useCallback(() => setFrame((f) => f + 1), []);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  /** Any member id of the zoomed forest (stable across forest re-indexing). */
  const [zoomId, setZoomId] = useState<string | null>(null);

  // ---- simulation: one per graph; relation changes re-settle the same one ----
  const relKey = [...relations].sort().join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the relation SET, not array identity
  const simLinks = useMemo(() => allLinks.filter((l) => relations.includes(l.type)), [allLinks, relKey]);
  const latest = useRef({ simLinks, relKey });
  latest.current = { simLinks, relKey };
  const lastHolder = useRef<SimHolder | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt per graph; relation changes re-settle the same sim
  const holder = useMemo<SimHolder>(() => {
    const old = lastHolder.current?.sim.nodes();
    const prev = old ? new Map(old.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])) : undefined;
    const sim = createAtlasSimulation({ skills: allSkills, links: latest.current.simLinks, prev });
    presettle(sim, prev ? 0.3 : 1); // live update: survivors re-settle gently from where they were
    return { sim, rel: latest.current.relKey };
  }, [allSkills, allLinks]);
  const sim = holder.sim;
  const byId = useMemo(() => new Map(sim.nodes().map((n) => [n.id, n])), [sim]);

  useEffect(() => {
    lastHolder.current = holder;
    holder.sim.on("tick", bump);
    onSimulation?.(holder.sim);
    return () => {
      holder.sim.on("tick", null);
      holder.sim.stop();
    };
  }, [holder, bump, onSimulation]);

  useEffect(() => {
    if (holder.rel === relKey) return;
    holder.rel = relKey;
    setRelationForces(holder.sim, simLinks);
    if (reduceMotion()) {
      presettle(holder.sim, 0.35);
      bump();
    } else {
      holder.sim.alpha(0.35);
      if (!document.hidden) holder.sim.restart();
    }
  }, [holder, relKey, simLinks, bump]);

  // ---- drawn forests (visible skills × drawn links) ----
  const drawn = useMemo(
    () =>
      forests(
        skills.map((s) => s.id),
        links,
      ),
    [skills, links],
  );
  const forestOf = useMemo(() => new Map(drawn.flatMap((g, i) => g.map((id) => [id, i] as const))), [drawn]);
  const forestIndex = (id: string | null): number | null => {
    const i = id ? forestOf.get(id) : undefined;
    return i !== undefined && drawn[i].length > 1 ? i : null;
  };
  const active = forestIndex(zoomId);

  const pos = (id: string): Point => {
    const n = byId.get(id);
    return { x: n?.x ?? 0, y: n?.y ?? 0 };
  };
  const focus = useMemo(() => (selected && hops ? hopSet(links, selected, hops) : null), [links, selected, hops]);
  const ids = new Set(skills.map((s) => s.id));

  /** Fit for the current target: zoomed forest, else focus set, else all visible skills. */
  const fitTarget = (forest: number | null, vp: Viewport = view): View => {
    const target = forest !== null ? drawn[forest] : focus ? [...focus].filter((i) => ids.has(i)) : [...ids];
    return fitView(boundsOf(target.map(pos), OUTLINE_PAD + 4), vp);
  };
  const fitRef = useRef(fitTarget);
  fitRef.current = fitTarget;
  const activeRef = useRef(active);
  activeRef.current = active;

  // ---- camera ----
  const tween = useRef(0);
  const stopTween = () => {
    if (tween.current) cancelAnimationFrame(tween.current);
    tween.current = 0;
  };
  const animateTo = (to: View) => {
    stopTween();
    const from = camRef.current;
    if (!from || reduceMotion()) {
      setCam(to);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const e = Math.min(1, (now - t0) / TWEEN_MS);
      const q = 1 - (1 - e) ** 3;
      setCam({ k: from.k + (to.k - from.k) * q, x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q });
      tween.current = e < 1 ? requestAnimationFrame(step) : 0;
    };
    tween.current = requestAnimationFrame(step);
  };
  /** Explicit fit (Fit, focus change, forest enter/exit): clears `userMoved`. */
  const explicitFit = (forest: number | null) => {
    userMoved.current = false;
    animateTo(fitTarget(forest));
  };
  const userCam = (v: View) => {
    stopTween();
    userMoved.current = true;
    setCam(v);
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setView((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First fit (mount) and resize refit while the user has not panned or zoomed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit only on viewport change
  useLayoutEffect(() => {
    if (userMoved.current) return;
    stopTween();
    setCam(fitRef.current(activeRef.current, view));
  }, [view.w, view.h]);

  // Focus change → explicit refit (leaves forest zoom). Skip the mount.
  const focusKey = focus ? `${selected}:${hops}` : "";
  const prevFocusKey = useRef(focusKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the focus set identity
  useLayoutEffect(() => {
    if (prevFocusKey.current === focusKey) return;
    prevFocusKey.current = focusKey;
    setZoomId(null);
    userMoved.current = false;
    animateTo(fitRef.current(null));
  }, [focusKey]);

  const zoomTo = (id: string | null) => {
    setZoomId(id);
    explicitFit(forestIndex(id));
  };

  // ---- pointer: one press model (click < 4 px; else pan or drag) ----
  const press = useRef<Press | null>(null);
  const dragged = useRef<SimNode | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const toModel = (clientX: number, clientY: number): Point => {
    const v = camRef.current ?? { k: 1, x: 0, y: 0 };
    const r = svgRef.current?.getBoundingClientRect();
    const sx = r?.width ? ((clientX - r.left) * view.w) / r.width : clientX - (r?.left ?? 0);
    const sy = r?.height ? ((clientY - r.top) * view.h) / r.height : clientY - (r?.top ?? 0);
    return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k };
  };
  const flush = () => {
    raf.current = 0;
    const n = dragged.current;
    const m = pending.current;
    if (n && m) dragMove(n, toModel(m.x, m.y));
  };
  /** Release an active drag: cancel the pending frame, unpin, cool down. A successful release first applies the last pointer position. */
  const releaseDrag = (commit: boolean) => {
    const n = dragged.current;
    const m = pending.current;
    if (commit && n && m) {
      const q = toModel(m.x, m.y);
      n.x = q.x;
      n.y = q.y;
    }
    pending.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (n) dragEnd(sim, n);
    dragged.current = null;
  };
  /** A press that stayed under the click threshold: select, zoom to forest, or leave zoom. */
  const clickAt = (p: Press) => {
    if (p.kind === "node") onSelect(p.target === selected ? null : p.target);
    else if (p.kind === "outline" && p.target) {
      svgRef.current?.focus({ preventScroll: true });
      zoomTo(p.target);
    } else if (active !== null) zoomTo(null);
  };
  /** End the press (up / cancel / lost capture); only a pointer-up click acts. */
  const endPress = (click: boolean, pointerId?: number) => {
    const p = press.current;
    if (p && pointerId !== undefined && pointerId !== p.pointerId) return;
    press.current = null;
    releaseDrag(click);
    if (p && !p.moved && click) clickAt(p);
  };
  /** First move past the click threshold: a node press becomes a drag. */
  const beginMove = (p: Press) => {
    p.moved = true;
    const n = p.kind === "node" && p.target ? byId.get(p.target) : undefined;
    if (!n) return;
    dragged.current = n;
    dragStart(sim, n);
  };
  const endPressRef = useRef(endPress);
  endPressRef.current = endPress;

  // Hidden → release + stop; visible → resume if still settling. Unmount → cancel frames.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        endPressRef.current(false);
        sim.stop();
      } else if (sim.alpha() >= sim.alphaMin()) sim.restart();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sim]);
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (tween.current) cancelAnimationFrame(tween.current);
      if (markRaf.current) cancelAnimationFrame(markRaf.current);
    },
    [],
  );

  // ---- first visible paint mark (per mount) ----
  // Two frames: the first runs before the visible graph paints, the second after it.
  const marked = useRef(false);
  const markRaf = useRef(0);
  useEffect(() => {
    if (!cam || marked.current || typeof performance === "undefined") return;
    marked.current = true;
    markRaf.current = requestAnimationFrame(() => {
      markRaf.current = requestAnimationFrame(() => {
        markRaf.current = 0;
        performance.mark?.("atlas-graph-rendered");
      });
    });
  }, [cam]);

  // ---- derived render data ----
  const v = cam ?? fitTarget(active);
  const at = (id: string): Point => {
    const p = pos(id);
    return { x: p.x * v.k + v.x, y: p.y * v.k + v.y };
  };
  const byDegree = useMemo(() => [...skills].sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1)), [skills]);
  const cursorId = cursor !== null && byDegree.length ? byDegree[cursor % byDegree.length].id : null;
  const neighbours = useMemo(() => (selected ? hopSet(links, selected, 1) : null), [links, selected]);
  const top = useMemo(() => new Set(byDegree.slice(0, 10).map((s) => s.id)), [byDegree]);
  const inActive = (id: string) => active === null || forestOf.get(id) === active;
  const radius = (s: SkillNode) => byId.get(s.id)?.r ?? 5;
  /** Label priority = index of the first matching rule (lower = more important); 9 = no label. */
  const labelRules: ((s: SkillNode) => boolean)[] = [
    (s) => s.id === selected,
    (s) => !!neighbours?.has(s.id),
    (s) => !!query && matches(s),
    (s) => s.id === cursorId,
    (s) => top.has(s.id),
    (s) => active !== null && inActive(s.id),
  ];
  const priority = (s: SkillNode) => {
    const i = labelRules.findIndex((r) => r(s));
    return i < 0 ? 9 : i;
  };
  const candidates: LabelCandidate[] = skills
    .filter(
      (s) =>
        s.id === hovered ||
        s.id === selected ||
        (priority(s) < 9 && (!focus || focus.has(s.id)) && inActive(s.id)),
    )
    .sort((a, b) => priority(a) - priority(b) || b.degree - a.degree || (a.id < b.id ? -1 : 1))
    .map((s) => ({ id: s.id, ...at(s.id), r: radius(s), hovered: s.id === hovered, selected: s.id === selected }));
  const nodeBoxes = skills.map((s) => {
    const p = at(s.id);
    const r = radius(s) + 1;
    return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
  });
  const labels = placeLabels(candidates, nodeBoxes, { x: 2, y: 2, w: view.w - 4, h: view.h - 4 });
  const dimmed = (s: SkillNode) => (focus && !focus.has(s.id)) || !matches(s) || !inActive(s.id);
  const outlinePad = Math.max(10, OUTLINE_PAD * Math.min(1, v.k));
  const outlines = drawn
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.length > 1)
    .map(({ g, i }) => ({ i, g, d: outlinePath(g.map(at), outlinePad) }));

  const keyActions: Record<string, () => void> = {
    ArrowRight: () => setCursor((c) => (c === null ? 0 : c + 1)),
    ArrowDown: () => setCursor((c) => (c === null ? 0 : c + 1)),
    ArrowLeft: () => setCursor((c) => Math.max(0, (c ?? 0) - 1)),
    ArrowUp: () => setCursor((c) => Math.max(0, (c ?? 0) - 1)),
    Escape: () => (active !== null ? zoomTo(null) : onSelect(null)),
  };
  const onKey = (e: React.KeyboardEvent) => {
    const select = (e.key === "Enter" || e.key === " ") && cursorId ? () => onSelect(cursorId) : undefined;
    const run = keyActions[e.key] ?? select;
    if (!run) return;
    run();
    e.preventDefault();
  };
  const zoomBy = (f: number) => {
    const cx = view.w / 2;
    const cy = view.h / 2;
    const k = Math.max(0.05, Math.min(8, v.k * f));
    const g = k / v.k;
    userCam({ k, x: cx - (cx - v.x) * g, y: cy - (cy - v.y) * g });
  };

  return (
    <div ref={wrap} className="relative h-full min-h-[420px] w-full" data-testid="skill-atlas-graph">
      <svg
        ref={svgRef}
        role="img"
        tabIndex={0}
        aria-roledescription={t("graphRole", undefined, "skill graph")}
        aria-label={t(
          "graphLabel",
          { skills: skills.length, links: links.length },
          `Skill graph, ${skills.length} skills, ${links.length} links. Arrow keys move between skills by connection count, Enter opens details. The Links tab lists the same data as a table.`,
        )}
        viewBox={`0 0 ${view.w} ${view.h}`}
        data-view={`${v.k},${v.x},${v.y}`}
        style={{ visibility: cam ? "visible" : "hidden" }}
        className="block h-full w-full cursor-grab touch-none focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
        onKeyDown={onKey}
        onWheel={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          const ox = e.clientX - (r?.left ?? 0);
          const oy = e.clientY - (r?.top ?? 0);
          const k = Math.max(0.05, Math.min(8, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
          const g = k / v.k;
          userCam({ k, x: ox - (ox - v.x) * g, y: oy - (oy - v.y) * g });
        }}
        onPointerDown={(e) => {
          if (e.button > 0 || press.current) return;
          const el = e.target as Element;
          const nodeEl = el.closest?.("[data-node]");
          const forestEl = nodeEl ? null : el.closest?.("[data-forest]");
          press.current = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            cam: v,
            kind: nodeEl ? "node" : forestEl ? "outline" : "bg",
            target: nodeEl?.getAttribute("data-node") ?? forestEl?.getAttribute("data-forest") ?? null,
            moved: false,
          };
          svgRef.current?.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || e.pointerId !== p.pointerId) return;
          if (!p.moved) {
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < CLICK_PX) return;
            beginMove(p);
          }
          if (p.kind === "node") {
            pending.current = { x: e.clientX, y: e.clientY };
            if (!raf.current) raf.current = requestAnimationFrame(flush);
          } else userCam({ ...p.cam, x: p.cam.x + e.clientX - p.x, y: p.cam.y + e.clientY - p.y });
        }}
        onPointerUp={(e) => endPress(true, e.pointerId)}
        onPointerCancel={(e) => endPress(false, e.pointerId)}
        onLostPointerCapture={(e) => endPress(false, e.pointerId)}
      >
        <defs>
          <marker id="atlas-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent-blue)" />
          </marker>
          <radialGradient id="atlas-aura">
            <stop offset="55%" stopColor="var(--accent-blue)" stopOpacity={0.02} />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0.12} />
          </radialGradient>
        </defs>
        <g data-testid="skill-atlas-outlines">
          {outlines.map(({ i, g, d }) => {
            const on = i === active;
            return (
              <path
                key={g[0]}
                d={d}
                data-forest={g[0]}
                data-testid={`skill-atlas-forest-${g[0]}`}
                fill="url(#atlas-aura)"
                stroke="var(--accent-blue-text)"
                strokeWidth={on ? 2 : 1.25}
                strokeDasharray={on ? undefined : "4 5"}
                strokeLinejoin="round"
                opacity={active !== null && !on ? 0.4 : 1}
                className="cursor-zoom-in"
              >
                <title>{t("outlineTitle", { count: g.length }, `${g.length} skills, click to zoom`)}</title>
              </path>
            );
          })}
        </g>
        <g className="pointer-events-none">
          {links
            .filter((l) => ids.has(l.source) && ids.has(l.target))
            .map((l) => {
              const a = at(l.source);
              const b = at(l.target);
              const s = RELATION_STYLE[l.type];
              const dim = (focus && !(focus.has(l.source) && focus.has(l.target))) || !inActive(l.source);
              return (
                <line
                  key={`${l.source}|${l.target}|${l.type}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={s.color}
                  strokeWidth={l.type === "shares-tool" ? 1.8 : 1.4}
                  strokeDasharray={s.dash}
                  strokeLinecap="round"
                  opacity={dim ? 0.12 : 0.75}
                  markerEnd={l.type === "references" ? "url(#atlas-arrow)" : undefined}
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
                data-node={s.id}
                data-testid={`skill-atlas-node-${s.id}`}
                transform={`translate(${p.x},${p.y})`}
                opacity={dimmed(s) ? 0.12 : 1}
                className={`cursor-pointer ${sel ? "[&_.atlas-shape]:stroke-[var(--focus-ring)] [&_.atlas-shape]:[stroke-width:3]" : ""} ${s.id === cursorId ? "[&_.atlas-shape]:stroke-[var(--focus-ring)] [&_.atlas-shape]:[stroke-dasharray:3_2]" : ""}`}
                onPointerEnter={() => setHovered(s.id)}
                onPointerLeave={() => setHovered((h) => (h === s.id ? null : h))}
              >
                <Dot origin={s.origin} r={radius(s)} />
                <title>{`${s.id} — ${t(ORIGIN_STYLE[s.origin].labelKey, undefined, ORIGIN_STYLE[s.origin].label)}`}</title>
              </g>
            );
          })}
        </g>
        <g aria-hidden="true" className="pointer-events-none">
          {skills
            .filter((s) => labels.has(s.id))
            .map((s) => {
              const b = labels.get(s.id) as { x: number; y: number };
              return (
                <text
                  key={s.id}
                  x={b.x + 1}
                  y={b.y + 11}
                  fontSize={11}
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fill={s.id === selected ? "var(--text-primary)" : "var(--text-secondary)"}
                  fontWeight={s.id === selected ? 600 : 400}
                  stroke="var(--bg-primary)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {s.id}
                </text>
              );
            })}
        </g>
      </svg>
      {active !== null && (
        <div
          className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]"
          data-testid="skill-atlas-forest-chip"
        >
          <span>{t("groupChip", { count: drawn[active].length }, `Group: ${drawn[active].length} skills`)}</span>
          <button
            type="button"
            onClick={() => {
              zoomTo(null);
              svgRef.current?.focus({ preventScroll: true });
            }}
            className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 min-h-[44px] sm:min-h-[28px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            {t("showAll", undefined, "Show all")}
          </button>
        </div>
      )}
      <div className="absolute bottom-3 left-3 grid gap-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]" aria-hidden="true">
        {(["project", "global", "package"] as const).map((o) => (
          <div key={o} className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="-7 -7 14 14">
              <Dot origin={o} r={5} hitArea={false} />
            </svg>
            {t(ORIGIN_STYLE[o].labelKey, undefined, ORIGIN_STYLE[o].label)}
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        {[
          { key: "in", icon: mdiMagnifyPlusOutline, label: t("zoomIn", undefined, "Zoom in"), run: () => zoomBy(1.25) },
          { key: "out", icon: mdiMagnifyMinusOutline, label: t("zoomOut", undefined, "Zoom out"), run: () => zoomBy(0.8) },
          { key: "fit", icon: mdiFitToScreenOutline, label: t("fitGraph", undefined, "Fit graph"), run: () => explicitFit(active) },
        ].map((b) => (
          <button
            key={b.key}
            type="button"
            aria-label={b.label}
            title={b.label}
            onClick={b.run}
            className="focus-ring inline-flex items-center justify-center rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Icon path={b.icon} size={0.7} />
          </button>
        ))}
      </div>
    </div>
  );
}
