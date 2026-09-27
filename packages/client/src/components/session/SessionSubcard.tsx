import React, { type ReactNode } from "react";
import { SubcardLegendMenu, type SubcardMenuTarget } from "./SubcardLegendMenu.js";

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
 *     rounded-lg, px-2 py-1.5, mt-1.5
 *   - Title: capsule (pill) overhanging the top border, filled with the card
 *     background (--bg-primary) so it masks the border line, fieldset-legend style
 *     (absolute -top-1.5, centered, uppercase, muted, 9px, tracking-wider)
 *   - Optional `menu`: a `⋯` options button inside the capsule, revealed on
 *     hover / focus-within (see `SubcardLegendMenu`).
 *     See change: configurable-session-card-sections (D8).
 */
export function SessionSubcard({
  title,
  menu,
  children,
}: {
  title: string;
  menu?: SubcardMenuTarget;
  children: ReactNode;
}) {
  if (!hasMeaningfulChildren(children)) return null;
  return (
    <div className="group/sub relative mt-1.5 rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 inline-flex items-center px-1.5 py-px rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] leading-none">
        {title}
        {menu ? <SubcardLegendMenu target={menu} label={title} /> : null}
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
