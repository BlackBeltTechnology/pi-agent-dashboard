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
 * markers that are FACTS rather than controls (the KB pill's compact stale marker)
 * stay in the pill as children.
 * See change: move-slot-actions-to-menu (directory-card-layout spec).
 *
 * Exported from `dashboard-plugin-runtime` (design D1) so all four folder
 * sections — living in separate plugin packages — share one source without a
 * new cross-package dependency. The class strings live here (an @source-scanned
 * package), so Tailwind compiles every accent variant regardless of caller.
 *
 * See change: redesign-directory-card (directory-card-layout spec).
 * See change: fix-slot-pill-legend-and-stale-overflow (11px legend, `SLOT_PILL_LEGEND`).
 */
import { Icon } from "@mdi/react";
import type { KeyboardEvent, ReactNode } from "react";

export type SlotAccent = "blue" | "indigo" | "cyan" | "teal" | "purple" | "red";

/**
 * Body surface variant. `raised` (default) = opaque `--bg-secondary` + shadow,
 * for sidebar folder cards. `flat` = NO fill and NO shadow (border only),
 * matching SessionSubcard so a folder section rendered inside a session card is
 * visually consistent with its OPENSPEC/GIT/PROCESS siblings.
 * See change: align-session-card-kb-slot-surface.
 */
export type SlotSurface = "raised" | "flat";

// Only the body background + shadow differ between variants; border, radius,
// hover-border, glyph chip, and the capsule legend are identical. Literal
// strings so Tailwind JIT-compiles both.
const SURFACE: Record<SlotSurface, string> = {
  raised: "bg-[var(--bg-secondary)] shadow-[0_1px_2px_var(--shadow-card)]",
  flat: "",
};

// The capsule legend must mask the border line it overhangs, so its fill
// follows the surface it sits on: the pill body when raised, the session-card
// background when the body itself is unfilled.
const LEGEND_BG: Record<SlotSurface, string> = {
  raised: "bg-[var(--bg-tertiary)]",
  flat: "bg-[var(--bg-primary)]",
};

/**
 * Surface-independent capsule-legend tokens (11px uppercase, `-top-2` overhang).
 * Shared by SlotPill and the inert OpenSpec mirror; SessionSubcard carries the
 * same size/weight/tracking/overhang/colour tokens, pinned by a parity test.
 * Literal string so Tailwind JIT-compiles it (this package is @source-scanned).
 * See change: fix-slot-pill-legend-and-stale-overflow.
 */
export const SLOT_PILL_LEGEND =
  "absolute -top-2 left-1/2 -translate-x-1/2 max-w-[calc(100%-12px)] truncate px-1.5 py-px rounded-full border border-[var(--border-subtle)] text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)] leading-none";

// Static accent map — Tailwind cannot JIT-scan a dynamic `text-[var(--accent-${h}-text)]`,
// so each accent resolves through a literal class string keyed off the union.
// Every key maps onto one of four host hues (blue/green/purple/red): the glyph
// chip is the slot's identity tint, painted with the `-text` ramp on `--tint-<h>-bg`
// (AA-safe in every palette). See change: fix-folder-card-pill-contrast (D3).
const BLUE = {
  icon: "text-[var(--accent-blue-text)]",
  glyphBg: "bg-[var(--tint-blue-bg)]",
  hoverBorder: "hover:border-[var(--tint-blue-border)]",
};
const GREEN = {
  icon: "text-[var(--accent-green-text)]",
  glyphBg: "bg-[var(--tint-green-bg)]",
  hoverBorder: "hover:border-[var(--tint-green-border)]",
};
const PURPLE = {
  icon: "text-[var(--accent-purple-text)]",
  glyphBg: "bg-[var(--tint-purple-bg)]",
  hoverBorder: "hover:border-[var(--tint-purple-border)]",
};
const RED = {
  icon: "text-[var(--accent-red-text)]",
  glyphBg: "bg-[var(--tint-red-bg)]",
  hoverBorder: "hover:border-[var(--tint-red-border)]",
};
const ACCENT: Record<SlotAccent, { icon: string; glyphBg: string; hoverBorder: string }> = {
  blue: BLUE,
  indigo: BLUE,
  cyan: GREEN,
  teal: GREEN,
  purple: PURPLE,
  red: RED,
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
      <span data-slot-pill-legend className={`${SLOT_PILL_LEGEND} ${LEGEND_BG[surface]}`}>
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
