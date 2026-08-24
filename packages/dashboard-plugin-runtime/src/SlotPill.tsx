/**
 * SlotPill — the shared single-concern directory-card slot pill.
 *
 * One presentational chip for every folder slot (Automations / Goals /
 * Knowledge base / OpenSpec): a capsule label overhanging the top border
 * (fieldset-legend style, centered so long labels never truncate), a
 * slot-colored leading glyph, and a bold count/value line (with an optional
 * inline state marker). The whole pill is one click target performing the
 * slot's primary navigation.
 *
 * The pill is STATE-ONLY: it exposes no prop for arbitrary action markup.
 * `actions?: ReactNode` was removed because the host cannot group, order,
 * keyboard-navigate or mobile-adapt opaque nodes, and nesting real `<button>`s
 * inside a `role="button"` root is an ARIA anti-pattern. Slot actions are
 * declarative items contributed to the folder actions menu instead. State
 * markers that are FACTS rather than controls (the KB pill's `⚠ N stale`)
 * stay in the pill as children.
 * See change: move-slot-actions-to-menu (directory-card-layout spec).
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

/**
 * Body surface variant. `raised` (default) = opaque `--bg-secondary` + shadow,
 * for sidebar folder cards. `flat` = translucent `color-mix(--bg-surface 50%)`
 * with NO shadow, matching SessionSubcard so a folder section rendered inside a
 * session card is visually consistent with its OPENSPEC/GIT/PROCESS siblings.
 * See change: align-session-card-kb-slot-surface.
 */
export type SlotSurface = "raised" | "flat";

// Only the body background + shadow differ between variants; border, radius,
// hover-border, glyph chip, and the capsule legend are identical. Literal
// strings so Tailwind JIT-compiles both.
const SURFACE: Record<SlotSurface, string> = {
  raised: "bg-[var(--bg-secondary)] shadow-[0_1px_2px_var(--shadow-card)]",
  flat: "bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]",
};

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
  /** Body surface variant (default `raised`). See {@link SlotSurface}. */
  surface?: SlotSurface;
}

export function SlotPill({
  glyph,
  accent,
  label,
  children,
  onActivate,
  activateTitle,
  activateTestId,
  surface = "raised",
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
      className={`focus-ring group relative flex items-center gap-2 min-w-0 px-2.5 pt-2.5 pb-1.5 rounded-[11px] border border-[var(--border-subtle)] ${SURFACE[surface]} cursor-pointer ${tone.hoverBorder}`}
    >
      {/* Label as a capsule overhanging the top border — fieldset-legend style
          (matches SessionSubcard's titled panel). Centered on the full pill
          width, so long labels (e.g. "Knowledge base") never truncate as they
          did inline. See change: slot-pill-capsule-label. */}
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 max-w-[calc(100%-12px)] truncate px-1.5 py-px rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[9px] font-semibold tracking-wider uppercase text-[var(--text-secondary)] leading-none">
        {label}
      </span>
      <span className={`shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center ${tone.glyphBg} ${tone.icon}`}>
        <Icon path={glyph} size={0.62} />
      </span>
      <span className="text-[13px] font-extrabold text-[var(--text-primary)] flex items-baseline gap-1.5 min-w-0 flex-1 leading-tight">
        {children}
      </span>
    </div>
  );
}
