/**
 * A labeled row of selectable filter chips. Reused by the sidebar for the
 * "Your tags" group (`tone="user"`, colorized) and the "Phase (read-only)"
 * group (`tone="exec"`, dashed). Selection state is owned by the parent
 * (`SessionList`) — this component is presentational.
 *
 * Rendered as a plain sub-label group under the sidebar's single master
 * `Tags` collapse (owned by `SessionList`); it carries no chevron of its own.
 * The user-tone group caps chip overflow at `cap` (default uncapped) with a
 * `+N more` / `show less` inline expander, and wires an optional per-chip
 * destructive remove (✕) via `onRemove`.
 * See change: add-session-tags · sidebar-tag-collapse-and-delete.
 */
import { useState } from "react";
import { TagChip } from "./TagChip.js";

interface TagFilterGroupProps {
  label: string;
  /** Filterable values (user tags, or phase names). */
  tags: string[];
  /** Currently-selected values. */
  selected: Set<string>;
  onToggle: (tag: string) => void;
  /** Colorized user tags vs dashed phase chips. */
  tone: "user" | "exec";
  /**
   * Overflow cap: show at most this many chips, then a `+N more` inline
   * expander. Omit (or 0) for no cap. See change: sidebar-tag-collapse-and-delete.
   */
  cap?: number;
  /** Per-chip destructive global-delete handler (user tone only). */
  onRemove?: (tag: string) => void;
}

export function TagFilterGroup({ label, tags, selected, onToggle, tone, cap, onRemove }: TagFilterGroupProps) {
  const [expanded, setExpanded] = useState(false);
  if (tags.length === 0) return null;
  const capped = cap && cap > 0 && tags.length > cap && !expanded;
  const shown = capped ? tags.slice(0, cap) : tags;
  const hidden = capped ? tags.length - cap! : 0;
  return (
    <div>
      <div className="mt-3 mb-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((tag) => (
          <TagChip
            key={tag}
            label={tag}
            variant="filter"
            tone={tone}
            selected={selected.has(tag)}
            onToggle={() => onToggle(tag)}
            onRemove={onRemove ? () => onRemove(tag) : undefined}
          />
        ))}
        {cap && cap > 0 && tags.length > cap ? (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            aria-expanded={expanded}
            className="rounded-full border border-[var(--border-secondary)] px-2 py-0.5 text-[11px] leading-tight text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-pointer"
            data-testid="tag-overflow-toggle"
          >
            {expanded ? "show less" : `+${hidden} more`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
