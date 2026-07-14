/**
 * Compact, read-only tag strip for the dense session card: the first `max`
 * user chips (colorized, no remove control), a `+N` overflow indicator when
 * there are more, and an optional read-only phase chip. The full editable
 * strip lives in the detail header (`TagEditor`). See change: add-session-tags.
 */

import type { OpenSpecPhase } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { TagChip } from "./TagChip.js";

interface TagStripProps {
  tags: string[];
  /** Read-only phase pseudo-tag (derived from `openspecPhase` only). */
  phase?: OpenSpecPhase | null;
  /** Max user chips before collapsing the rest into `+N`. */
  max?: number;
}

export function TagStrip({ tags, phase, max = 3 }: TagStripProps) {
  if (tags.length === 0 && !phase) return null;

  const shown = tags.slice(0, max);
  const overflow = tags.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((tag) => (
        <TagChip key={tag} label={tag} variant="user" />
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex items-center rounded-full border border-[var(--border-secondary)] bg-transparent px-2 py-0.5 text-[11px] leading-tight text-[var(--text-muted)]"
          aria-label={`${overflow} more tags`}
        >
          +{overflow}
        </span>
      ) : null}
      {phase ? <TagChip label={phase} variant="exec" /> : null}
    </div>
  );
}
