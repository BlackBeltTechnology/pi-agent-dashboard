/**
 * Cards view: visible skills grouped by origin (project, global) and package.
 * Non-matching skills are HIDDEN by the caller (dimmed text would fail WCAG
 * 1.4.3). See change: add-skill-atlas-screen (ui-plan S2).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import type { SkillLink, SkillNode } from "../shared/types.js";
import { ORIGIN_STYLE, shortPkg } from "./relation-style.js";

export function SkillCardsView({
  skills,
  links,
  selected,
  onSelect,
}: {
  skills: readonly SkillNode[];
  links: readonly SkillLink[];
  selected: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const t = useT();
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const l of links) {
    if (l.type !== "references") continue;
    out.set(l.source, (out.get(l.source) ?? 0) + 1);
    inn.set(l.target, (inn.get(l.target) ?? 0) + 1);
  }
  const groups = new Map<string, SkillNode[]>();
  for (const s of skills) {
    const key = s.origin === "package" ? `pkg:${s.pkg ?? ""}` : s.origin;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rank = (k: string) => (k === "project" ? 0 : k === "global" ? 1 : 2);
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  return (
    <div className="grid gap-4 p-4" data-testid="skill-atlas-cards">
      {keys.map((k) => {
        const origin = k.startsWith("pkg:") ? "package" : (k as "project" | "global");
        const name = origin === "package" ? shortPkg(k.slice(4)) : t(ORIGIN_STYLE[origin].labelKey, undefined, ORIGIN_STYLE[origin].label);
        const list = groups.get(k) ?? [];
        return (
          <section key={k}>
            <h3 className="m-0 mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
              <span aria-hidden="true">{ORIGIN_STYLE[origin].glyph}</span>
              {name} <span className="font-normal">{list.length}</span>
            </h3>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={s.id === selected}
                  data-testid={`skill-atlas-card-${s.id}`}
                  onClick={() => onSelect(s.id)}
                  className={`focus-ring flex flex-col gap-1.5 rounded-xl border bg-[var(--bg-secondary)] p-3 text-left shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)] hover:bg-[var(--bg-hover)] ${
                    s.id === selected ? "border-[var(--tint-blue-border)]" : "border-[var(--border-secondary)]"
                  }`}
                >
                  <span className="text-[13.5px] font-semibold text-[var(--text-primary)] break-words">{s.id}</span>
                  <span className="line-clamp-2 text-[12px] text-[var(--text-secondary)]">{s.description}</span>
                  <span className="flex gap-2.5 text-[11px] text-[var(--text-secondary)]">
                    <span title={t("refsOut", undefined, "names other skills")}>→ {out.get(s.id) ?? 0}</span>
                    <span title={t("refsIn", undefined, "named by other skills")}>← {inn.get(s.id) ?? 0}</span>
                    <span>{t("linksTotal", { count: s.degree }, `${s.degree} links total`)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
