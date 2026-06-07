import React, { useState, useRef, useEffect, useMemo } from "react";
import { Dialog } from "./Dialog.js";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
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
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelect(filtered[selectedIndex].value);
      }
    }
  };

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
              filtered.map((opt, i) => (
                <div
                  key={opt.value}
                  onClick={() => onSelect(opt.value)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-2 ${
                    i === selectedIndex
                      ? "bg-blue-500/15 text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">{opt.label}</div>
                    {opt.description && (
                      <div className="text-[10px] text-[var(--text-muted)] truncate">{opt.description}</div>
                    )}
                  </div>
                  {opt.badge && (
                    <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${opt.badgeColor || "text-[var(--text-tertiary)]"}`}>
                      {opt.badge}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer hint */}
          <div className="pt-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
            ↑↓ navigate · Enter select · Esc cancel
          </div>
    </Dialog>
  );
}
