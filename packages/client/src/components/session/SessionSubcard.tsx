import React, { type ReactNode } from "react";

/**
 * Inset titled panel used to group related session-card sections
 * (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS).
 *
 * Renders nothing when children resolve to null, false, undefined, or
 * an empty array — call sites keep their existing prop guards and the
 * wrapper auto-hides when those guards short-circuit.
 *
 * Visual contract:
 *   - Inset panel: no fill (transparent), border-[--border-subtle],
 *     rounded-lg, px-2 pt-2.5 pb-1.5, mt-2.5
 *   - Title: capsule (pill) overhanging the top border, filled with the card
 *     background (--bg-primary) so it masks the border line, fieldset-legend style
 *     (absolute -top-2, centered, uppercase, muted, 11px, semibold, tracking-wide;
 *     same tokens as `SLOT_PILL_LEGEND`, pinned by a parity test)
 *   - No per-subcard options menu: the legend `⋯` is gone; section options
 *     live in the session actions menu's VIEW group.
 *     See change: add-session-actions-flyout (D8).
 * See change: fix-slot-pill-legend-and-stale-overflow.
 */
export function SessionSubcard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  if (!hasMeaningfulChildren(children)) return null;
  return (
    <div className="group/sub relative mt-2.5 rounded-lg border border-[var(--border-subtle)] px-2 pt-2.5 pb-1.5">
      <span className="absolute -top-2 left-1/2 -translate-x-1/2 inline-flex items-center px-1.5 py-px rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] leading-none">
        {title}
      </span>
      {children}
    </div>
  );
}

function hasMeaningfulChildren(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false) return false;
  if (Array.isArray(children) && children.length === 0) return false;
  return true;
}
