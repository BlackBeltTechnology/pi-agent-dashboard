/**
 * A labeled row of selectable filter chips. Reused by the sidebar for the
 * "Your tags" group (`tone="user"`, colorized) and the "Phase (read-only)"
 * group (`tone="exec"`, dashed). Selection state is owned by the parent
 * (`SessionList`) — this component is presentational.
 * See change: add-session-tags.
 */
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
}

export function TagFilterGroup({ label, tags, selected, onToggle, tone }: TagFilterGroupProps) {
  if (tags.length === 0) return null;
  return (
    <div>
      <div className="mt-3 mb-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <TagChip
            key={tag}
            label={tag}
            variant="filter"
            tone={tone}
            selected={selected.has(tag)}
            onToggle={() => onToggle(tag)}
          />
        ))}
      </div>
    </div>
  );
}
