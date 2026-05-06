import React, { useState, useEffect, useRef, useCallback } from "react";
import { fetchBranches } from "../lib/git-api.js";
import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

interface Props {
  cwd: string;
  onSelect: (branch: string) => void;
  onCancel: () => void;
  onNotGitRepo?: () => void;
  rows?: number;
  /** Currently selected branch name (highlighted in the list) */
  selected?: string | null;
}

export function BranchPicker({ cwd, onSelect, onCancel, onNotGitRepo, rows = 10, selected }: Props) {
  const [filter, setFilter] = useState("");
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBranches(cwd);
      setBranches(data.branches);
      setCurrent(data.current);
    } catch (err: any) {
      const msg = err.message ?? "Failed to load branches";
      if (msg.includes("not a git repository") && onNotGitRepo) {
        onNotGitRepo();
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Filter branches by text (case-insensitive contains)
  const lowerFilter = filter.toLowerCase();
  const filtered = filter
    ? branches.filter((b) => b.name.toLowerCase().includes(lowerFilter))
    : branches;

  // Split into local and remote sections
  const localBranches = filtered.filter((b) => !b.isRemote);
  const remoteBranches = filtered.filter((b) => b.isRemote);

  // Build flat display list
  type DisplayItem =
    | { type: "branch"; branch: GitBranchEntry }
    | { type: "separator" };

  const displayItems: DisplayItem[] = [];
  for (const b of localBranches) displayItems.push({ type: "branch", branch: b });
  if (remoteBranches.length > 0) {
    if (localBranches.length > 0) displayItems.push({ type: "separator" });
    for (const b of remoteBranches) displayItems.push({ type: "branch", branch: b });
  }

  const selectableIndices = displayItems
    .map((item, i) => (item.type === "branch" ? i : -1))
    .filter((i) => i >= 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => {
        const currentIdx = selectableIndices.indexOf(prev);
        const next = currentIdx < selectableIndices.length - 1 ? selectableIndices[currentIdx + 1] : selectableIndices[0];
        return next ?? prev;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => {
        const currentIdx = selectableIndices.indexOf(prev);
        const next = currentIdx > 0 ? selectableIndices[currentIdx - 1] : selectableIndices[selectableIndices.length - 1];
        return next ?? prev;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < displayItems.length) {
        const item = displayItems[highlightIndex];
        if (item.type === "branch") {
          onSelect(item.branch.name);
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-branch-item]");
    items[highlightIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [highlightIndex]);

  // Reset highlight when filter changes
  useEffect(() => { setHighlightIndex(-1); }, [filter]);

  const rowHeight = 32;
  const listHeight = rows * rowHeight;

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Filter branches…"
        className="w-full bg-[var(--bg-tertiary)] rounded px-3 py-2 text-base border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none font-mono"
        autoFocus
      />
      <div
        ref={listRef}
        className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)]"
        style={{ height: listHeight }}
        role="listbox"
      >
        {loading && (
          <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">Loading…</div>
        )}
        {error && (
          <div className="px-3 py-2 text-sm text-red-400">{error}</div>
        )}
        {!loading && !error && displayItems.length === 0 && (
          <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">No branches found</div>
        )}
        {!loading && !error && displayItems.map((item, i) => {
          if (item.type === "separator") {
            return (
              <div key="sep" data-branch-item className="px-3 py-1 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-secondary)] uppercase tracking-wider">
                Remote
              </div>
            );
          }
          const { branch } = item;
          const isHighlighted = i === highlightIndex;
          const isCurrentBranch = branch.isCurrent;
          return (
            <div
              key={branch.name}
              data-branch-item
              role="option"
              aria-selected={isHighlighted}
              className={`px-3 py-1 text-sm flex items-center gap-2 cursor-pointer transition-all active:scale-[0.98] ${
                selected === branch.name
                  ? "bg-blue-600/20 ring-1 ring-blue-500/40"
                  : isHighlighted
                    ? "bg-blue-600/30"
                    : "hover:bg-[var(--bg-secondary)]"
              }`}
              onClick={() => onSelect(branch.name)}
            >
              <span className={`w-3 text-center flex-shrink-0 ${isCurrentBranch ? "text-green-400" : ""}`}>
                {isCurrentBranch ? "●" : ""}
              </span>
              <span className={`flex-1 truncate font-mono text-xs ${isCurrentBranch ? "text-green-400" : ""}`}>
                {branch.name}
              </span>
              {branch.isRemote && (
                <span className="text-[10px] text-[var(--text-muted)]">remote</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
