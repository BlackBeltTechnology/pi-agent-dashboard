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
 *   - Inset panel: translucent via color-mix(--bg-surface 50% / transparent),
 *     border-[--border-subtle], rounded-lg, px-2 py-1.5, mt-1.5
 *   - Title: capsule (pill) overhanging the top border, fieldset-legend style
 *     (absolute -top-1.5, centered, uppercase, muted, 9px, tracking-wider)
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
    <div className="relative mt-1.5 rounded-lg border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)] px-2 py-1.5">
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-px rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] leading-none">
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
