/**
 * Links view — the graph's text equivalent: one table row per drawn link
 * (source, relation, target, reason). See change: add-skill-atlas-screen.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import type { SkillLink } from "../shared/types.js";
import { RelationGlyph } from "./RelationGlyph.js";
import { RELATION_STYLE } from "./relation-style.js";

export function SkillLinksView({ links, onSelect }: { links: readonly SkillLink[]; onSelect: (id: string) => void }): React.ReactElement {
  const t = useT();
  const cell = "border-b border-[var(--border-subtle)] px-3 py-1.5 align-top";
  const head = "sticky top-0 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-left font-semibold text-[var(--text-secondary)]";
  const linkBtn = "focus-ring min-h-[24px] text-left font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline";
  return (
    <table className="w-full border-collapse text-[12px]" data-testid="skill-atlas-links">
      <caption className="sr-only">{t("linksCaption", { count: links.length }, `Skill relations, ${links.length} rows`)}</caption>
      <thead>
        <tr>
          <th scope="col" className={head}>{t("colFrom", undefined, "From")}</th>
          <th scope="col" className={head}>{t("colRelation", undefined, "Relation")}</th>
          <th scope="col" className={head}>{t("colTo", undefined, "To")}</th>
          <th scope="col" className={head}>{t("colWhy", undefined, "Why")}</th>
        </tr>
      </thead>
      <tbody>
        {links.map((l) => (
          <tr key={`${l.source}|${l.target}|${l.type}`}>
            <td className={cell}>
              <button type="button" className={linkBtn} onClick={() => onSelect(l.source)}>{l.source}</button>
            </td>
            <td className={cell}>
              <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                <RelationGlyph type={l.type} />
                {t(RELATION_STYLE[l.type].labelKey, undefined, RELATION_STYLE[l.type].label)}
              </span>
            </td>
            <td className={cell}>
              <button type="button" className={linkBtn} onClick={() => onSelect(l.target)}>{l.target}</button>
            </td>
            <td className={`${cell} text-[var(--text-secondary)]`}>{l.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
