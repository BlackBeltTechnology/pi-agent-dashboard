/**
 * Full atlas page (project or global): header with scope + freshness status,
 * APG tabs (Cards / Graph / Links), search, relation + origin toggles (a
 * "Filters · N on" disclosure below `sm`), the active view and the detail
 * panel. Graph dims non-matches; Cards/Links hide them and show
 * "Showing N of M · Clear". Above GRAPH_NODE_CAP the Graph tab is disabled.
 * Initial selection may come from `?sel=<id>&hops=<n>`.
 * See change: add-skill-atlas-screen (ui-plan S2, design D9).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiArrowLeft } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { GRAPH_NODE_CAP, type SkillAtlasScope, type SkillLinkType, type SkillNode, type SkillOrigin } from "../shared/types.js";
import { hopSet } from "./graph-layout.js";
import { ORIGIN_STYLE, ORIGIN_TYPES, RELATION_STYLE, RELATION_TYPES } from "./relation-style.js";
import { RelationGlyph } from "./RelationGlyph.js";
import { SkillCardsView } from "./SkillCardsView.js";
import { SkillDetailPanel } from "./SkillDetailPanel.js";
import { SkillGraphView } from "./SkillGraphView.js";
import { SkillLinksView } from "./SkillLinksView.js";
import { useSkillGraph } from "./useSkillGraph.js";

type View = "cards" | "graph" | "links";
const VIEWS: readonly View[] = ["cards", "graph", "links"];
const VIEW_LABEL: Record<View, readonly [string, string]> = { cards: ["viewCards", "Cards"], graph: ["viewGraph", "Graph"], links: ["viewLinks", "Links"] };
/** Static severity triples (Tailwind must see literal class names). */
const CALLOUT = {
  warning: "bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]",
  info: "bg-[var(--severity-info-bg)] border-[var(--severity-info-border)] text-[var(--severity-info-fg)]",
  error: "bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]",
} as const;

export interface SkillAtlasPageProps {
  scope: SkillAtlasScope;
  cwd?: string;
  onBack: () => void;
}

export default function SkillAtlasPage({ scope, cwd, onBack }: SkillAtlasPageProps): React.ReactElement {
  const t = useT();
  const search = useSearch();
  const initial = useMemo(() => new URLSearchParams(search), [search]);
  const { graph, loading, updating, error, refetch } = useSkillGraph(scope, cwd);
  const [view, setView] = useState<View>("graph");
  const [query, setQuery] = useState("");
  const [rel, setRel] = useState<Record<SkillLinkType, boolean>>({ references: true, bundle: true, "shares-tool": true });
  const [org, setOrg] = useState<Record<SkillOrigin, boolean>>({ project: true, global: true, package: true });
  const [selected, setSelected] = useState<string | null>(initial.get("sel"));
  const [hops, setHops] = useState<number>(Number(initial.get("hops") ?? 0) || 0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({ cards: null, graph: null, links: null });

  const tooMany = (graph?.skills.length ?? 0) > GRAPH_NODE_CAP;
  const activeView: View = tooMany && view === "graph" ? "cards" : view;

  const visibleSkills = useMemo(() => (graph?.skills ?? []).filter((s) => org[s.origin]), [graph, org]);
  const visibleIds = useMemo(() => new Set(visibleSkills.map((s) => s.id)), [visibleSkills]);
  const visibleLinks = useMemo(
    () => (graph?.links ?? []).filter((l) => rel[l.type] && visibleIds.has(l.source) && visibleIds.has(l.target)),
    [graph, rel, visibleIds],
  );
  const q = query.trim().toLowerCase();
  const matches = (s: SkillNode) => !q || s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  const focus = selected && hops ? hopSet(visibleLinks, selected, hops) : null;
  const keep = (s: SkillNode) => matches(s) && (!focus || focus.has(s.id));
  const listedSkills = visibleSkills.filter(keep);
  const listedIds = new Set(listedSkills.map((s) => s.id));
  const listedLinks = visibleLinks.filter(
    (l) =>
      (matches(graph?.skills.find((s) => s.id === l.source) as SkillNode) || matches(graph?.skills.find((s) => s.id === l.target) as SkillNode)) &&
      (!focus || (focus.has(l.source) && focus.has(l.target))),
  );
  const narrowed = activeView !== "graph" && (q || focus);
  const selectedSkill = graph?.skills.find((s) => s.id === selected) ?? null;

  // A skill removed by a live update clears the selection.
  useEffect(() => {
    if (graph && selected && !graph.skills.some((s) => s.id === selected)) {
      setSelected(null);
      setHops(0);
    }
  }, [graph, selected]);

  const select = (id: string | null) => {
    setSelected(id);
    if (!id) setHops(0);
  };
  const enabledViews = VIEWS.filter((v) => !(v === "graph" && tooMany));
  const onTabKey = (e: React.KeyboardEvent, v: View) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = enabledViews.indexOf(v);
    const next = enabledViews[(i + (e.key === "ArrowRight" ? 1 : enabledViews.length - 1)) % enabledViews.length];
    setView(next);
    tabRefs.current[next]?.focus();
    e.preventDefault();
  };
  const filtersOn = Object.values(rel).filter(Boolean).length + Object.values(org).filter(Boolean).length;
  const chip =
    "focus-ring inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold has-[:checked]:bg-[var(--tint-blue-bg)] has-[:checked]:border-[var(--tint-blue-border)] has-[:checked]:text-[var(--tint-blue-fg)] border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]";
  const callout = (sev: keyof typeof CALLOUT) => `rounded-md border px-3 py-2 text-[12px] ${CALLOUT[sev]}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]" data-testid="skill-atlas-page">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-primary)] px-4 py-3">
        <button type="button" onClick={onBack} className="focus-ring inline-flex min-h-[32px] items-center gap-1 text-[12px] text-[var(--link)] hover:text-[var(--link-hover)]" data-testid="skill-atlas-back">
          <Icon path={mdiArrowLeft} size={0.6} />
          {t("back", undefined, "Back")}
        </button>
        <h1 className="m-0 text-lg font-semibold">{t("title", undefined, "Skill Atlas")}</h1>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${scope === "project" ? ORIGIN_STYLE.project.pill : ORIGIN_STYLE.global.pill}`}
          data-testid="skill-atlas-scope"
        >
          {scope === "project"
            ? `${ORIGIN_STYLE.project.glyph} ${t("scopeProject", { folder: cwd?.split(/[\\/]/).filter(Boolean).pop() ?? "" }, `Project · ${cwd?.split(/[\\/]/).filter(Boolean).pop() ?? ""}`)}`
            : `${ORIGIN_STYLE.global.glyph} ${t("scopeGlobal", undefined, "Global")}`}
        </span>
        {graph && (
          <span className="text-[11px] text-[var(--text-secondary)]">
            {t("counts", { skills: graph.skills.length, links: graph.links.length }, `${graph.skills.length} skills · ${graph.links.length} links`)}
          </span>
        )}
        <span role="status" className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]" data-testid="skill-atlas-status">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: updating || loading ? "var(--status-working)" : "var(--status-idle)" }} />
          {updating || loading ? t("statusUpdating", undefined, "Updating…") : t("statusFresh", undefined, "Up to date")}
        </span>
      </header>

      {(graph?.degraded || tooMany || (error && graph)) && (
        <div className="grid gap-2 px-4 pt-2">
          {graph?.degraded && <div className={callout("warning")}>{t("degraded", undefined, "pi's resolver was unavailable, so the list comes from a directory walk. It may differ from what pi loads.")}</div>}
          {tooMany && (
            <div className={callout("info")} data-testid="skill-atlas-too-many">
              {t("tooMany", { count: graph?.skills.length ?? 0, cap: GRAPH_NODE_CAP }, `${graph?.skills.length} skills is more than the graph can show legibly (limit ${GRAPH_NODE_CAP}). Use Cards or Links, or narrow with the filters.`)}
            </div>
          )}
          {error && graph && <div role="alert" className={callout("error")}>{t("loadError", { error }, `Could not build the skill graph: ${error}`)}</div>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-primary)] px-4 py-2">
        <div role="tablist" aria-label={t("viewTabs", undefined, "Atlas view")} className="inline-flex overflow-hidden rounded-md border border-[var(--border-secondary)]">
          {VIEWS.map((v) => {
            const disabled = v === "graph" && tooMany;
            return (
              <button
                key={v}
                ref={(el) => {
                  tabRefs.current[v] = el;
                }}
                type="button"
                role="tab"
                id={`skill-atlas-tab-${v}`}
                aria-controls="skill-atlas-panel"
                aria-selected={activeView === v}
                aria-disabled={disabled || undefined}
                tabIndex={activeView === v ? 0 : -1}
                onClick={() => !disabled && setView(v)}
                onKeyDown={(e) => onTabKey(e, v)}
                className={`focus-ring px-3 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold ${
                  activeView === v ? "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]" : disabled ? "cursor-not-allowed bg-[var(--bg-tertiary)] text-[var(--text-muted)]" : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                }`}
              >
                {t(VIEW_LABEL[v][0], undefined, VIEW_LABEL[v][1])}
              </button>
            );
          })}
        </div>
        <label className="sr-only" htmlFor="skill-atlas-search">{t("searchLabel", undefined, "Search skills")}</label>
        <input
          id="skill-atlas-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder", undefined, "Search skills…")}
          className="focus-ring min-h-[44px] sm:min-h-[36px] w-full max-w-xs flex-1 basis-56 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="skill-atlas-filters"
          onClick={() => setFiltersOpen((o) => !o)}
          className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] text-[12px] font-semibold sm:hidden"
          data-testid="skill-atlas-filters-toggle"
        >
          {t("filtersOn", { count: filtersOn }, `Filters · ${filtersOn} on`)}
        </button>
        <div id="skill-atlas-filters" className={`${filtersOpen ? "flex" : "hidden"} w-full flex-col gap-2 sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center`}>
          <div role="group" aria-label={t("relations", undefined, "Relations")} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{t("relations", undefined, "Relations")}</span>
            {RELATION_TYPES.map((k) => (
              <label key={k} className={chip}>
                <input type="checkbox" className="m-0 accent-[var(--accent-primary)]" checked={rel[k]} onChange={(e) => setRel((r) => ({ ...r, [k]: e.target.checked }))} />
                <RelationGlyph type={k} />
                {t(RELATION_STYLE[k].labelKey, undefined, RELATION_STYLE[k].label)}
                <span className="font-normal">{graph?.links.filter((l) => l.type === k).length ?? 0}</span>
              </label>
            ))}
          </div>
          <div role="group" aria-label={t("origin", undefined, "Origin")} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{t("origin", undefined, "Origin")}</span>
            {ORIGIN_TYPES.filter((o) => scope === "project" || o !== "project").map((o) => (
              <label key={o} className={chip}>
                <input type="checkbox" className="m-0 accent-[var(--accent-primary)]" checked={org[o]} onChange={(e) => setOrg((r) => ({ ...r, [o]: e.target.checked }))} />
                <span aria-hidden="true">{ORIGIN_STYLE[o].glyph}</span>
                {t(ORIGIN_STYLE[o].labelKey, undefined, ORIGIN_STYLE[o].label)}
                <span className="font-normal">{graph?.skills.filter((s) => s.origin === o).length ?? 0}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {narrowed && (
        <div role="status" className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2 text-[12px] text-[var(--text-secondary)]" data-testid="skill-atlas-showing">
          {t("showing", { shown: listedSkills.length, total: visibleSkills.length }, `Showing ${listedSkills.length} of ${visibleSkills.length} skills`)}
          <button
            type="button"
            className="focus-ring min-h-[24px] font-semibold text-[var(--link)] hover:underline"
            onClick={() => {
              setQuery("");
              setHops(0);
            }}
          >
            {t("clear", undefined, "Clear")}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div id="skill-atlas-panel" role="tabpanel" aria-labelledby={`skill-atlas-tab-${activeView}`} className="relative min-h-[420px] min-w-0 flex-1 overflow-auto">
          {!graph && loading && <div className="p-4 text-[12px] text-[var(--text-secondary)]" aria-busy="true">{t("loading", undefined, "Loading skills…")}</div>}
          {!graph && error && (
            <div className="m-4 flex items-start gap-2" role="alert">
              <span className={`${callout("error")} flex-1`}>{t("loadError", { error }, `Could not build the skill graph: ${error}`)}</span>
              <button type="button" onClick={refetch} className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[36px] text-[12px] font-semibold">
                {t("retry", undefined, "Retry")}
              </button>
            </div>
          )}
          {graph && graph.skills.length === 0 && (
            <div className="m-4 grid justify-items-center gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-6 text-center" data-testid="skill-atlas-empty">
              <h2 className="m-0 text-[15px] font-semibold">{t("emptyTitle", undefined, "No skills load here")}</h2>
              <p className="m-0 text-[12px] text-[var(--text-secondary)]">{t("emptyBody", undefined, "pi found no skill with a description in this scope.")}</p>
            </div>
          )}
          {graph && graph.skills.length > 0 && activeView === "graph" && (
            <SkillGraphView
              allSkills={graph.skills}
              allLinks={graph.links}
              skills={visibleSkills}
              links={visibleLinks}
              selected={selected}
              hops={hops}
              matches={matches}
              query={q}
              onSelect={select}
            />
          )}
          {graph && graph.skills.length > 0 && activeView === "cards" && (
            <SkillCardsView skills={listedSkills} links={visibleLinks.filter((l) => listedIds.has(l.source) || listedIds.has(l.target))} selected={selected} onSelect={select} />
          )}
          {graph && graph.skills.length > 0 && activeView === "links" && <SkillLinksView links={listedLinks} onSelect={select} />}
        </div>
        <aside
          aria-label={t("detailLabel", undefined, "Skill details")}
          className={`flex-none overflow-auto border-[var(--border-primary)] p-3 lg:w-80 lg:border-l ${selected ? "order-first border-b lg:order-none lg:border-b-0" : "border-t lg:border-t-0"}`}
        >
          <SkillDetailPanel skill={selectedSkill} links={visibleLinks} hops={hops} onHops={setHops} onSelect={select} />
        </aside>
      </div>
    </div>
  );
}

