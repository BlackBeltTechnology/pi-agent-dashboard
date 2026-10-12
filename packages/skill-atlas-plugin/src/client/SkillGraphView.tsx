/**
 * SVG force-graph view. Layout computed once per graph in model space, scaled
 * to the measured viewport (focus re-fits to the k-hop set). Shapes encode
 * origin; edges encode relation by colour + dash (+ arrow for references).
 * Keyboard: arrows walk nodes by degree, Enter selects, Esc clears.
 * Emits `performance.mark("atlas-graph-rendered")` after the first paint (P4).
 * See change: add-skill-atlas-screen (design D9, ui-plan S2).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiFitToScreenOutline, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillLink, SkillNode, SkillOrigin } from "../shared/types.js";
import { fitTransform, hopSet, layoutGraph, placeLabels, type Point, type Viewport } from "./graph-layout.js";
import { ORIGIN_STYLE, RELATION_STYLE } from "./relation-style.js";

export interface SkillGraphViewProps {
  allSkills: readonly SkillNode[];
  allLinks: readonly SkillLink[];
  /** Visible (origin-filtered) skills and relation-filtered links. */
  skills: readonly SkillNode[];
  links: readonly SkillLink[];
  selected: string | null;
  hops: number;
  matches: (s: SkillNode) => boolean;
  query: string;
  onSelect: (id: string | null) => void;
}

function NodeShape({ origin, r }: { origin: SkillOrigin; r: number }) {
  const base = { fill: "var(--bg-secondary)", stroke: "var(--border-strong)", strokeWidth: 1.5, className: "atlas-shape" };
  if (origin === "project") {
    const d = (k: number) => `0,${-k} ${k},0 0,${k} ${-k},0`;
    return (
      <>
        <polygon points={d(r + 2)} {...base} />
        <polygon points={d(r + 6)} fill="none" stroke="var(--accent-green)" strokeWidth={2.5} />
      </>
    );
  }
  if (origin === "package") return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={2} {...base} />;
  return <circle r={r} {...base} />;
}

let renderedMarked = false;

export function SkillGraphView(props: SkillGraphViewProps): React.ReactElement {
  const t = useT();
  const { allSkills, allLinks, skills, links, selected, hops, matches, query, onSelect } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Viewport>({ w: 900, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; pan: Point } | null>(null);

  // Positions depend only on the full graph — filters never move nodes.
  const points = useMemo(() => layoutGraph(allSkills, allLinks), [allSkills, allLinks]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setView({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (renderedMarked || typeof performance === "undefined") return;
    renderedMarked = true;
    requestAnimationFrame(() => performance.mark?.("atlas-graph-rendered"));
  }, []);

  const focus = useMemo(() => (selected && hops ? hopSet(links, selected, hops) : null), [links, selected, hops]);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [selected, hops]);

  const ids = new Set(skills.map((s) => s.id));
  const byDegree = useMemo(() => [...skills].sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1)), [skills]);
  const cursorId = cursor !== null && byDegree.length ? byDegree[cursor % byDegree.length].id : null;
  const at = fitTransform(points, focus ? [...focus].filter((i) => ids.has(i)) : skills.map((s) => s.id), view, zoom, pan);
  const neighbours = selected ? hopSet(links, selected, 1) : null;
  const top = new Set(byDegree.slice(0, 10).map((s) => s.id));
  const priority = (s: SkillNode) =>
    s.id === selected ? 0 : neighbours?.has(s.id) ? 1 : query && matches(s) ? 2 : s.id === cursorId ? 3 : top.has(s.id) ? 4 : 9;
  const labelled = placeLabels(
    skills
      .filter((s) => priority(s) < 9 && (!focus || focus.has(s.id)))
      .map((s) => ({ id: s.id, ...at(s.id), priority: priority(s) })),
  );
  const dimmed = (s: SkillNode) => (focus && !focus.has(s.id)) || !matches(s);
  const radius = (s: SkillNode) => 5 + Math.min(7, Math.sqrt(s.degree) * 1.6);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") setCursor((c) => (c === null ? 0 : c + 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setCursor((c) => Math.max(0, (c ?? 0) - 1));
    else if ((e.key === "Enter" || e.key === " ") && cursorId) onSelect(cursorId);
    else if (e.key === "Escape") onSelect(null);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={wrap} className="relative h-full min-h-[420px] w-full" data-testid="skill-atlas-graph">
      <svg
        role="img"
        tabIndex={0}
        aria-roledescription={t("graphRole", undefined, "skill graph")}
        aria-label={t(
          "graphLabel",
          { skills: skills.length, links: links.length },
          `Skill graph, ${skills.length} skills, ${links.length} links. Arrow keys move between skills by connection count, Enter opens details. The Links tab lists the same data as a table.`,
        )}
        viewBox={`0 0 ${view.w} ${view.h}`}
        className="block h-full w-full cursor-grab touch-none focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
        onKeyDown={onKey}
        onWheel={(e) => setZoom((z) => Math.max(0.5, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9))))}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node]")) return;
          drag.current = { x: e.clientX, y: e.clientY, pan };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <defs>
          <marker id="atlas-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent-blue)" />
          </marker>
        </defs>
        <g>
          {links
            .filter((l) => ids.has(l.source) && ids.has(l.target))
            .map((l) => {
              const a = at(l.source);
              const b = at(l.target);
              const s = RELATION_STYLE[l.type];
              const dim = focus && !(focus.has(l.source) && focus.has(l.target));
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
                onClick={() => onSelect(sel ? null : s.id)}
              >
                <NodeShape origin={s.origin} r={radius(s)} />
                <title>{`${s.id} — ${t(ORIGIN_STYLE[s.origin].labelKey, undefined, ORIGIN_STYLE[s.origin].label)}`}</title>
              </g>
            );
          })}
        </g>
        <g aria-hidden="true">
          {skills
            .filter((s) => labelled.has(s.id))
            .map((s) => {
              const p = at(s.id);
              return (
                <text
                  key={s.id}
                  x={p.x + 12}
                  y={p.y + 4}
                  fontSize={11}
                  fill={s.id === selected ? "var(--text-primary)" : "var(--text-secondary)"}
                  fontWeight={s.id === selected ? 600 : 400}
                  stroke="var(--bg-primary)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  className="pointer-events-none"
                >
                  {s.id}
                </text>
              );
            })}
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 grid gap-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]" aria-hidden="true">
        {(["project", "global", "package"] as const).map((o) => (
          <div key={o} className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="-7 -7 14 14">
              <NodeShape origin={o} r={4} />
            </svg>
            {t(ORIGIN_STYLE[o].labelKey, undefined, ORIGIN_STYLE[o].label)}
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        {[
          { key: "in", icon: mdiMagnifyPlusOutline, label: t("zoomIn", undefined, "Zoom in"), run: () => setZoom((z) => Math.min(5, z * 1.25)) },
          { key: "out", icon: mdiMagnifyMinusOutline, label: t("zoomOut", undefined, "Zoom out"), run: () => setZoom((z) => Math.max(0.5, z * 0.8)) },
          {
            key: "fit",
            icon: mdiFitToScreenOutline,
            label: t("fitGraph", undefined, "Fit graph"),
            run: () => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            },
          },
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
