import React, { useState, useRef, useEffect, useMemo } from "react";
import { Dialog } from "./Dialog.js";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
  /**
   * Group caption this option renders under. Options sharing a group render
   * beneath one caption, in first-appearance order; ungrouped options keep
   * the flat list. Inert unless set.
   */
  group?: string;
  /**
   * Rendered visible but non-selectable (e.g. a picker entry whose selection
   * would overwrite a conflicting credential). Arrow navigation skips it and
   * Enter is a no-op. Inert unless set.
   */
  disabled?: boolean;
  /** Tooltip for a disabled option — names the way out (e.g. remove-first). */
  disabledReason?: string;
  /**
   * Always rendered, even when the search filter does not match — for a
   * pinned entry (e.g. "Custom endpoint…") that must stay reachable under any
   * search term. Inert unless set.
   */
  pinned?: boolean;
}

interface Props {
  title: string;
  options: SelectOption[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  placeholder?: string;
  emptyMessage?: string;
}

export function SearchableSelectDialog({
  title,
  options,
  onSelect,
  onCancel,
  placeholder = "Search...",
  emptyMessage = "No items found",
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    // `value` is the id — the picker contract matches on display name AND id.
    // Pinned options stay reachable under any search term.
    return options.filter(
      (o) =>
        o.pinned ||
        o.label.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  // Scroll selected item into view. A group caption renders as its own child
  // before its options, so children indices no longer map to option indices —
  // target the selected row by attribute instead.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const moveSelection = (dir: 1 | -1) => {
    setSelectedIndex((i) => {
      let next = i;
      // Arrow navigation skips disabled options so Enter never lands on one.
      do {
        next += dir;
      } while (next > 0 && next < filtered.length - 1 && filtered[next]?.disabled);
      return Math.max(0, Math.min(next, filtered.length - 1));
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[selectedIndex];
      if (opt && !opt.disabled) {
        onSelect(opt.value);
      }
    }
  };

  let lastGroup: string | undefined;

  return (
    <Dialog open onClose={onCancel} title={title} size="sm">
          {/* Search */}
          <div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-64 overflow-y-auto px-1 pb-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">{emptyMessage}</div>
            ) : (
              filtered.map((opt, i) => {
                const caption = opt.group !== undefined && opt.group !== lastGroup ? opt.group : null;
                lastGroup = opt.group;
                return (
                  <React.Fragment key={opt.value}>
                    {caption && (
                      <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        {caption}
                      </div>
                    )}
                    <div
                      role="option"
                      aria-selected={i === selectedIndex && !opt.disabled}
                      aria-disabled={opt.disabled || undefined}
                      title={opt.disabled ? opt.disabledReason : undefined}
                      data-active={i === selectedIndex}
                      onClick={() => { if (!opt.disabled) onSelect(opt.value); }}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${
                        opt.disabled
                          ? "cursor-not-allowed opacity-55"
                          : "cursor-pointer"
                      } ${
                        i === selectedIndex
                          ? "bg-blue-500/15 text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate">{opt.label}</div>
                        {opt.description && (
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            {opt.description}
                          </div>
                        )}
                      </div>
                      {opt.badge && (
                        <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${opt.badgeColor || "text-[var(--text-tertiary)]"}`}>
                          {opt.badge}
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="pt-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
            ↑↓ navigate · Enter select · Esc cancel
          </div>
    </Dialog>
  );
}
