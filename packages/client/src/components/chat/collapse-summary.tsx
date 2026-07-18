/**
 * collapse-summary — shared primitives for the PROCESS subcard's unified
 * summary line (change: stable-process-line).
 *
 * Two pieces, both previously hand-rolled inside `ProcessList` /
 * `SessionActivityBar`:
 *   - `splitOverflow` — pure sort-then-slice split into a visible head + an
 *     overflow tail. Drives both the in-flight activity rows and the
 *     background-process rows when the line is expanded.
 *   - `CollapseSummary` — the clickable chevron toggle button that fronts the
 *     collapsed line. Owns `aria-expanded` + click→onToggle; the caller
 *     composes the line's content (command / counts pill / elapsed) as
 *     children.
 *
 * See change: stable-process-line.
 */
import { mdiChevronDown, mdiChevronRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";

export interface OverflowSplit<T> {
  visible: T[];
  overflow: T[];
}

/**
 * Sort (when `compare` given) then split into the first `max` visible entries
 * and the rest as overflow. Pure; never mutates the input.
 */
export function splitOverflow<T>(
  items: readonly T[],
  max: number,
  compare?: (a: T, b: T) => number,
): OverflowSplit<T> {
  const ordered = compare ? [...items].sort(compare) : [...items];
  return { visible: ordered.slice(0, max), overflow: ordered.slice(max) };
}

/**
 * The collapsed-line toggle: a full-width button with a leading chevron that
 * flips on `expanded`. Children render the line content to the chevron's
 * right. Stops propagation so a click toggles the line without selecting the
 * card.
 */
export function CollapseSummary({
  expanded,
  onToggle,
  children,
  className,
  testId,
  ariaLabel,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`flex items-center gap-1.5 w-full text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] ${className ?? ""}`}
    >
      <Icon
        path={expanded ? mdiChevronDown : mdiChevronRight}
        size={0.4}
        className="flex-shrink-0"
      />
      {children}
    </button>
  );
}
