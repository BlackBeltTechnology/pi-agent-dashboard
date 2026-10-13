/**
 * Detail panel for the selected skill: description, path, origin + package,
 * focus control (All / 1 hop / 2 hops), neighbours grouped by relation with the
 * reason (mutual references merged into one ↔ row), "Open SKILL.md" through the
 * restricted resource-file route (refusal → inline error).
 * See change: add-skill-atlas-screen (ui-plan S2).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { SkillLink, SkillNode } from "../shared/types.js";
import { canOpenSkillFile, piResourceViewerUrl } from "./atlas-api.js";
import { neighbourRows } from "./graph-layout.js";
import { RelationGlyph } from "./RelationGlyph.js";
import { ORIGIN_STYLE, RELATION_STYLE, RELATION_TYPES, shortPkg } from "./relation-style.js";

export function SkillDetailPanel({
  skill,
  links,
  hops,
  onHops,
  onSelect,
}: {
  skill: SkillNode | null;
  links: readonly SkillLink[];
  hops: number;
  onHops: (h: number) => void;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const t = useT();
  const [, navigate] = useLocation();
  const [openError, setOpenError] = useState(false);
  useEffect(() => setOpenError(false), [skill?.id]);
  if (!skill) {
    return (
      <p className="m-0 p-2 text-[12px] text-[var(--text-secondary)]" data-testid="skill-atlas-detail-empty">
        {t("detailEmpty", undefined, "Select a skill in the graph, a card, or the table to see what it connects to.")}
      </p>
    );
  }
  const o = ORIGIN_STYLE[skill.origin];
  const groups = RELATION_TYPES.map((type) => ({ type, rows: neighbourRows(skill.id, links, type) })).filter((g) => g.rows.length);
  const seg = "focus-ring px-2.5 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold";
  const open = async () => {
    if (await canOpenSkillFile(skill.filePath)) navigate(piResourceViewerUrl(skill.filePath, skill.id));
    else setOpenError(true);
  };
  return (
    <div className="grid gap-2.5 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]" data-testid="skill-atlas-detail">
      <h3 className="m-0 break-words text-[15px] font-semibold text-[var(--text-primary)]">{skill.id}</h3>
      <div className="flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${o.pill}`}>
          {o.glyph} {t(o.labelKey, undefined, o.label)}
        </span>
        <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
          {skill.pkg ? shortPkg(skill.pkg) : t("loose", undefined, "loose")}
        </span>
      </div>
      <p className="m-0 text-[12px] text-[var(--text-secondary)]">{skill.description}</p>
      <div className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{skill.filePath}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{t("focus", undefined, "Focus")}</span>
        <div role="group" aria-label={t("focusLabel", undefined, "Neighbourhood focus")} className="inline-flex overflow-hidden rounded-md border border-[var(--border-secondary)]">
          {[
            [0, t("focusAll", undefined, "All")],
            [1, t("focus1", undefined, "1 hop")],
            [2, t("focus2", undefined, "2 hops")],
          ].map(([h, label]) => (
            <button
              key={h}
              type="button"
              aria-pressed={hops === h}
              onClick={() => onHops(h as number)}
              className={`${seg} ${hops === h ? "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]" : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.type}>
            <h4 className="m-0 mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
              <RelationGlyph type={g.type} />
              {t(RELATION_STYLE[g.type].labelKey, undefined, RELATION_STYLE[g.type].label)} ({g.rows.length})
            </h4>
            {g.rows.map((r) => (
              <button
                key={r.id}
                type="button"
                data-testid={`skill-atlas-neighbour-${r.id}`}
                onClick={() => onSelect(r.id)}
                className="focus-ring flex w-full min-h-[44px] sm:min-h-[32px] flex-col items-start justify-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                  {r.direction ? `${r.direction} ` : ""}
                  {r.id}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">{r.why}</span>
              </button>
            ))}
          </div>
        ))
      ) : (
        <p className="m-0 text-[12px] text-[var(--text-secondary)]">
          {t("noRelations", undefined, "No relations found. This skill does not name others and shares no package or tool.")}
        </p>
      )}
      {openError && (
        <div role="alert" className="rounded-md border px-3 py-2 text-[12px] bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]" data-testid="skill-atlas-open-error">
          {t("openRefused", undefined, "This SKILL.md cannot be opened here: the dashboard only reads files in known pi resource locations.")}
        </div>
      )}
      <button
        type="button"
        onClick={() => void open()}
        className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[36px] text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        {t("openSkillFile", undefined, "Open SKILL.md")}
      </button>
    </div>
  );
}
