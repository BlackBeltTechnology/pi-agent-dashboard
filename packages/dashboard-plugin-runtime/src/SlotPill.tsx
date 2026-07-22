/**
 * SlotPill — the shared single-concern directory-card slot pill.
 *
 * One presentational chip for every folder slot (Automations / Goals / KB /
 * OpenSpec): a slot-colored leading glyph, an uppercase micro-label, a bold
 * count/value line (with an optional inline state marker), and an optional
 * trailing action cluster. The whole pill is one click target performing the
 * slot's primary navigation; trailing action buttons stop propagation so they
 * fire their own handlers.
 *
 * Exported from `dashboard-plugin-runtime` (design D1) so all four folder
 * sections — living in separate plugin packages — share one source without a
 * new cross-package dependency. The class strings live here (an @source-scanned
 * package), so Tailwind compiles every accent variant regardless of caller.
 *
 * See change: redesign-directory-card (directory-card-layout spec).
 */
import { Icon } from "@mdi/react";
import type { KeyboardEvent, ReactNode } from "react";

export type SlotAccent = "blue" | "indigo" | "cyan" | "teal" | "purple" | "red";

// Static accent map — Tailwind cannot JIT-scan a dynamic `text-${accent}-400`,
// so each accent resolves through a literal class string keyed off the union.
const ACCENT: Record<SlotAccent, { icon: string; glyphBg: string; hoverBorder: string }> = {
  blue: { icon: "text-blue-400", glyphBg: "bg-blue-500/10", hoverBorder: "hover:border-blue-500/45" },
  indigo: { icon: "text-indigo-400", glyphBg: "bg-indigo-500/10", hoverBorder: "hover:border-indigo-500/45" },
  cyan: { icon: "text-cyan-400", glyphBg: "bg-cyan-500/10", hoverBorder: "hover:border-cyan-500/45" },
  teal: { icon: "text-teal-400", glyphBg: "bg-teal-500/10", hoverBorder: "hover:border-teal-500/45" },
  purple: { icon: "text-purple-400", glyphBg: "bg-purple-500/10", hoverBorder: "hover:border-purple-500/45" },
  red: { icon: "text-red-400", glyphBg: "bg-red-500/10", hoverBorder: "hover:border-red-500/45" },
};

export interface SlotPillProps {
  /** Leading glyph (mdi path). */
  glyph: string;
  accent: SlotAccent;
  /** Uppercase micro-label (e.g. "Automations", "Knowledge base"). */
  label: string;
  /**
   * Bold count/value line content — passed as children so callers keep their
   * own test-ids (e.g. `folder-kb-count`) and inline state markers.
   */
  children?: ReactNode;
  /** Primary navigation. The whole pill is its click target. */
  onActivate?: () => void;
  activateTitle?: string;
  /** Test id for the click/navigation target (the pill root). */
  activateTestId?: string;
  /** Trailing action button cluster (section-owned; each stops propagation). */
  actions?: ReactNode;
}

export function SlotPill({
  glyph,
  accent,
  label,
  children,
  onActivate,
  activateTitle,
  activateTestId,
  actions,
}: SlotPillProps) {
  const tone = ACCENT[accent];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onActivate && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={activateTestId}
      onClick={(e) => { e.stopPropagation(); onActivate?.(); }}
      onKeyDown={onKeyDown}
      title={activateTitle}
      className={`focus-ring group flex items-center gap-2 min-w-0 px-2.5 py-1.5 rounded-[11px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-[0_1px_2px_var(--shadow-card)] cursor-pointer ${tone.hoverBorder}`}
    >
      <span className={`shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center ${tone.glyphBg} ${tone.icon}`}>
        <Icon path={glyph} size={0.62} />
      </span>
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
        <span className="text-[10px] font-extrabold tracking-wider uppercase text-[var(--text-secondary)] truncate">
          {label}
        </span>
        <span className="text-[13px] font-extrabold text-[var(--text-primary)] flex items-baseline gap-1.5 min-w-0">
          {children}
        </span>
      </span>
      {actions && (
        <span className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </div>
  );
}
