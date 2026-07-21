import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBranches } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { BranchListbox, useBranchListboxKeyboard } from "./BranchListbox.js";

interface Props {
  cwd: string;
  onSelect: (branch: string) => void;
  onCancel: () => void;
  onNotGitRepo?: () => void;
  rows?: number;
}

/**
 * Always-open branch picker (filter input + listbox + Cancel) used by
 * `BranchSwitchDialog` and the icon-click checkout flow. Delegates row
 * rendering + keyboard nav to `BranchListbox`. Owns fetching and the
 * loading/error/empty states.
 *
 * See change: worktree-base-branch-typeahead.
 */
export function BranchPicker({ cwd, onSelect, onCancel, onNotGitRepo, rows = 10 }: Props) {
  const [filter, setFilter] = useState("");
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBranches(cwd);
      setBranches(data.branches);
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
  }, [cwd, onNotGitRepo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const { handleKey } = useBranchListboxKeyboard({
    branches,
    filter,
    highlightIndex,
    onHighlightChange: setHighlightIndex,
    onSelect,
    disableCurrent: true,
  });

  // Reset highlight when filter changes.
  useEffect(() => { setHighlightIndex(-1); }, [filter]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    handleKey(e);
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={i18nT("git.filterBranches", undefined, "Filter branches…")}
        className="w-full bg-[var(--bg-tertiary)] rounded px-3 py-2 text-sm border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none font-mono"
        autoFocus
      />
      {loading ? (
        <div
          className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--text-secondary)]"
          style={{ height: rows * 32 }}
        >
          {i18nT("common.loading2", undefined, "Loading…")}
        </div>
      ) : error ? (
        <div
          className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-red-400"
          style={{ height: rows * 32 }}
        >
          {error}
        </div>
      ) : (
        <BranchListbox
          branches={branches}
          filter={filter}
          highlightIndex={highlightIndex}
          onHighlightChange={setHighlightIndex}
          onSelect={onSelect}
          disableCurrent
          rows={rows}
        />
      )}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        >
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </div>
    </div>
  );
}
