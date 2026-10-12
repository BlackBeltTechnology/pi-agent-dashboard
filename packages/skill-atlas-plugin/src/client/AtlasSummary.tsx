/**
 * Compact atlas summary: counts, per-relation counts with glyph + word, the
 * five most-connected skills (each opens the atlas focused on it), and an
 * "Open atlas" action. Empty scope renders nothing; degraded → warning line;
 * error → alert + Retry. Used by the Skills-page section and the promoted
 * settings entry. See change: add-skill-atlas-screen (ui-plan S1).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useLocation } from "wouter";
import type { SkillAtlasScope } from "../shared/types.js";
import { atlasUrl } from "./atlas-api.js";
import { topByDegree } from "./graph-layout.js";
import { RelationGlyph } from "./RelationGlyph.js";
import { RELATION_STYLE, RELATION_TYPES } from "./relation-style.js";
import { useSkillGraph } from "./useSkillGraph.js";

export function AtlasSummary({ scope, cwd }: { scope: SkillAtlasScope; cwd?: string }): React.ReactElement | null {
  const t = useT();
  const [, navigate] = useLocation();
  const { graph, loading, error, refetch } = useSkillGraph(scope, cwd);
  const box = "rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] p-3 mb-3";
  const heading = (
    <h2 className="text-[12px] font-semibold text-[var(--text-secondary)] m-0">{t("title", undefined, "Skill Atlas")}</h2>
  );

  if (loading && !graph) {
    return (
      <section className={box} aria-busy="true" aria-label={t("title", undefined, "Skill Atlas")} data-testid="skill-atlas-summary-loading">
        {heading}
        <div className="mt-2 h-3 w-3/5 rounded bg-[var(--bg-hover)] motion-safe:animate-pulse" />
      </section>
    );
  }
  if (error && !graph) {
    return (
      <section className={`${box} flex flex-wrap items-center gap-3`} data-testid="skill-atlas-summary-error">
        <div className="flex-1 min-w-0 grid gap-1.5">
          {heading}
          <div role="alert" className="rounded-md border px-3 py-2 text-[12px] bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]">
            {t("loadError", { error }, `Could not build the skill graph: ${error}`)}
          </div>
        </div>
        <button type="button" onClick={refetch} className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[36px] text-[12px] font-semibold text-[var(--text-primary)]">
          {t("retry", undefined, "Retry")}
        </button>
      </section>
    );
  }
  if (!graph || graph.skills.length === 0) return null;

  const counts = Object.fromEntries(RELATION_TYPES.map((k) => [k, graph.links.filter((l) => l.type === k).length]));
  const local = graph.skills.filter((s) => s.origin === "project").length;
  const hubs = topByDegree(graph.skills, 5);
  return (
    <section className={`${box} grid gap-3 md:grid-cols-[1fr_auto] md:items-center`} aria-labelledby="skill-atlas-summary-h" data-testid="skill-atlas-summary">
      <div className="grid gap-2 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="skill-atlas-summary-h" className="text-[12px] font-semibold text-[var(--text-secondary)] m-0">
            {t("title", undefined, "Skill Atlas")}
          </h2>
          <span className="text-[12px] text-[var(--text-secondary)]">
            {scope === "project"
              ? t("countsProject", { skills: graph.skills.length, links: graph.links.length, local }, `${graph.skills.length} skills · ${graph.links.length} links · ${local} from this folder`)
              : t("counts", { skills: graph.skills.length, links: graph.links.length }, `${graph.skills.length} skills · ${graph.links.length} links`)}
          </span>
        </div>
        {graph.degraded && (
          <div className="rounded-md border px-3 py-2 text-[12px] bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]" data-testid="skill-atlas-degraded">
            {t("degraded", undefined, "pi's resolver was unavailable, so the list comes from a directory walk. It may differ from what pi loads.")}
          </div>
        )}
        <ul className="flex flex-wrap gap-x-3 gap-y-1 list-none m-0 p-0" aria-label={t("relations", undefined, "Relations")}>
          {RELATION_TYPES.map((k) => (
            <li key={k} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <RelationGlyph type={k} />
              {t(RELATION_STYLE[k].labelKey, undefined, RELATION_STYLE[k].label)} <span>{counts[k]}</span>
            </li>
          ))}
        </ul>
        {hubs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-[var(--text-secondary)]">{t("mostConnected", undefined, "Most connected:")}</span>
            {hubs.map((h) => (
              <button
                key={h.id}
                type="button"
                data-testid={`skill-atlas-hub-${h.id}`}
                onClick={() => navigate(atlasUrl(scope, cwd, h.id, 1))}
                className="focus-ring inline-flex items-center gap-1 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                {h.id} <span className="font-normal text-[var(--text-secondary)]">{h.degree}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        data-testid="skill-atlas-open"
        onClick={() => navigate(atlasUrl(scope, cwd))}
        className="focus-ring justify-self-start rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[36px] text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        {t("openAtlas", undefined, "Open atlas →")}
      </button>
    </section>
  );
}
