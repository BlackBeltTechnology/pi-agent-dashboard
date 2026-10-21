import type { ChangeDependencies, DependencyEdgeSource, DependencyIssue } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Dependency chips on a proposal card: blocked-by / blocks / overlap counts, the
 * execution wave and validator issue badges. A chip is a focusable button that
 * lists its entries (name, source, reason) while focused or toggled open —
 * keyboard reachable, never hover-only. Inferred edges are italic with a dashed
 * outline so they read differently from declared ones.
 *
 * See change: add-openspec-change-dependencies.
 */

type ListKey = "blockedBy" | "blocks" | "overlaps" | "issues";

const CHIP =
  "focus-ring inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium leading-none border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
const CHIP_WARN = "bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]";
const CHIP_ERROR = "bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]";

const sourceLabel = (s: DependencyEdgeSource): string =>
  s === "declared"
    ? i18nT("openspec.dependencies.sourceDeclared", undefined, "declared")
    : s === "inferred-text"
      ? i18nT("openspec.dependencies.sourceText", undefined, "inferred from text")
      : i18nT("openspec.dependencies.sourceCapability", undefined, "inferred from capability");

export function DependencyChips({ dependencies }: { dependencies: ChangeDependencies }) {
  const [open, setOpen] = useState<ListKey | null>(null);
  const d = dependencies;
  const openBlockers = d.blockedBy.filter((e) => e.state === "open");
  const errors = d.issues.filter((i) => i.severity === "error");
  const warnings = d.issues.filter((i) => i.severity === "warning");
  const issueList = [...errors, ...warnings];

  const chip = (key: ListKey, label: string, cls = "") => (
    <button
      type="button"
      className={`${CHIP} ${cls}`}
      data-testid={`dep-chip-${key}`}
      aria-expanded={open === key}
      aria-controls={`dep-list-${key}`}
      onFocus={() => setOpen(key)}
      // A mouse press would focus the button (opening the list) and the click that follows would toggle it
      // straight shut again; keep the press from focusing, so click toggles and Tab/focus still opens.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOpen((cur) => (cur === key ? null : key))}
    >
      {label}
    </button>
  );

  const hasAny = openBlockers.length > 0 || d.blocks.length > 0 || d.overlaps.length > 0 || issueList.length > 0 || d.wave !== null;
  if (!hasAny) return null;

  return (
    <div
      className="mt-1.5 flex flex-col gap-1"
      data-testid="dep-chips"
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(null);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        {d.wave !== null && (
          <span className={`${CHIP} cursor-default`} data-testid="dep-wave" title={i18nT("openspec.dependencies.waveTitle", undefined, "Execution wave")}>
            {i18nT("openspec.dependencies.wave", { wave: String(d.wave) }, "wave {wave}")}
          </span>
        )}
        {openBlockers.length > 0 &&
          chip("blockedBy", i18nT("openspec.dependencies.blockedByCount", { count: String(openBlockers.length) }, "blocked by {count}"))}
        {d.blocks.length > 0 && chip("blocks", i18nT("openspec.dependencies.blocksCount", { count: String(d.blocks.length) }, "blocks {count}"))}
        {d.overlaps.length > 0 &&
          chip("overlaps", i18nT("openspec.dependencies.overlapCount", { count: String(d.overlaps.length) }, "overlaps {count}"))}
        {issueList.length > 0 &&
          chip(
            "issues",
            i18nT("openspec.dependencies.issueCount", { count: String(issueList.length) }, "{count} issue(s)"),
            errors.length > 0 ? CHIP_ERROR : CHIP_WARN,
          )}
      </div>

      {open === "blockedBy" && (
        <ul id="dep-list-blockedBy" className="m-0 list-none p-0 text-[11px] text-[var(--text-secondary)]" data-testid="dep-list-blockedBy">
          {d.blockedBy.map((e) => (
            <li
              key={e.change}
              data-source={e.source}
              data-state={e.state}
              className={e.source === "declared" ? "" : "italic border-l border-dashed border-[var(--border-secondary)] pl-1.5"}
            >
              <span className="font-mono text-[var(--text-primary)]">{e.change}</span>
              {" · "}
              {e.state === "satisfied" ? i18nT("openspec.dependencies.satisfied", undefined, "satisfied") : sourceLabel(e.source)}
              {e.reason ? ` · ${e.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
      {open === "blocks" && (
        <ul id="dep-list-blocks" className="m-0 list-none p-0 text-[11px] text-[var(--text-secondary)]" data-testid="dep-list-blocks">
          {d.blocks.map((n) => (
            <li key={n} className="font-mono text-[var(--text-primary)]">{n}</li>
          ))}
        </ul>
      )}
      {open === "overlaps" && (
        <ul id="dep-list-overlaps" className="m-0 list-none p-0 text-[11px] text-[var(--text-secondary)]" data-testid="dep-list-overlaps">
          {d.overlaps.map((n) => (
            <li key={n} className="font-mono text-[var(--text-primary)]">{n}</li>
          ))}
        </ul>
      )}
      {open === "issues" && (
        <ul id="dep-list-issues" className="m-0 list-none p-0 text-[11px] text-[var(--text-secondary)]" data-testid="dep-list-issues">
          {issueList.map((i: DependencyIssue, idx) => (
            <li key={`${i.code}-${idx}`} data-severity={i.severity}>
              <span className="font-semibold">{i.code}</span> — {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
