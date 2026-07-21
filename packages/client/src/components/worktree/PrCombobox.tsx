/**
 * Typeahead combobox for picking an open pull request from a repository.
 * Fetches the PR list lazily on first open. Reuses keyboard navigation
 * patterns from `BranchCombobox` but owns a richer row renderer (number,
 * title, author, CI/draft badge).
 *
 * See change: add-worktree-from-pull-request.
 */

import type { PullRequestInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { type FetchPrResult, fetchPullRequests } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  value: PullRequestInfo | null;
  onChange: (pr: PullRequestInfo) => void;
  /** Fires when the fetch reveals gh is unavailable. */
  onGhUnavailable?: (code: "gh_not_found" | "gh_not_authed") => void;
  "data-testid"?: string;
}

export function PrCombobox({
  cwd,
  value,
  onChange,
  onGhUnavailable,
  "data-testid": testid,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [prs, setPrs] = useState<PullRequestInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  // Reset cached state when cwd changes.
  useEffect(() => {
    setPrs(null);
    setFetched(false);
    setError(null);
    setLoading(false);
  }, [cwd]);

  // Fetch on first open.
  useEffect(() => {
    if (!open || fetched) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPullRequests(cwd).then((result: FetchPrResult) => {
      if (cancelled) return;
      setLoading(false);
      setFetched(true);
      if (result.ok) {
        setPrs(result.data);
      } else {
        if (result.code === "gh_not_found" || result.code === "gh_not_authed") {
          onGhUnavailable?.(result.code as "gh_not_found" | "gh_not_authed");
        }
        setError(result.error);
      }
    });
    return () => { cancelled = true; };
  }, [open, fetched, cwd, onGhUnavailable]);

  const filtered = useMemo(() => {
    if (!prs) return [];
    if (!filter) return prs;
    const lower = filter.toLowerCase();
    return prs.filter(
      (pr) =>
        String(pr.number).includes(lower) ||
        pr.title.toLowerCase().includes(lower) ||
        pr.headRefName.toLowerCase().includes(lower),
    );
  }, [prs, filter]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setFilter("");
    setHighlightIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    (pr: PullRequestInfo) => {
      onChange(pr);
      close(true);
    },
    [onChange, close],
  );

  // Reset highlight on filter change.
  useEffect(() => { setHighlightIndex(-1); }, [filter]);

  // Autofocus filter on open.
  useEffect(() => { if (open) filterInputRef.current?.focus(); }, [open]);

  // Outside-click closes.
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      const target = e.target as Node | null;
      if (target && !rootRef.current.contains(target)) close(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, close]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlightIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
      return;
    }
    if (e.key === "Enter") {
      if (highlightIndex >= 0 && highlightIndex < filtered.length) {
        e.preventDefault();
        handleSelect(filtered[highlightIndex]!);
      }
    }
  };

  const triggerLabel = value
    ? `#${value.number} · ${value.title}`
    : "Select a pull request";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        data-testid={testid}
        className={`w-full mt-0.5 px-2 py-1 text-sm rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] flex items-center gap-2 text-left cursor-pointer ${
          value ? "" : "text-[var(--text-muted)]"
        }`}
      >
        <span className="flex-1 truncate">{triggerLabel}</span>
        <span className="text-[var(--text-muted)]">▾</span>
      </button>
      {open && (
        <div
          id={popoverId}
          data-testid={testid ? `${testid}-popover` : undefined}
          className="absolute left-0 right-0 mt-1 z-10 p-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg flex flex-col gap-2"
        >
          <input
            ref={filterInputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={i18nT("git.filterByTitleOrBranch", undefined, "Filter by #, title, or branch…")}
            data-testid={testid ? `${testid}-filter` : undefined}
            className="w-full bg-[var(--bg-tertiary)] rounded px-2 py-1 text-sm border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none font-mono"
          />
          <PrListbox
            items={filtered}
            loading={loading}
            error={error}
            highlightIndex={highlightIndex}
            onHighlightChange={setHighlightIndex}
            onSelect={handleSelect}
            selectedNumber={value?.number}
          />
        </div>
      )}
    </div>
  );
}

// ── Presentational listbox ────────────────────────────────────────────

function PrListbox({
  items,
  loading,
  error,
  highlightIndex,
  onHighlightChange,
  onSelect,
  selectedNumber,
}: {
  items: PullRequestInfo[];
  loading: boolean;
  error: string | null;
  highlightIndex: number;
  onHighlightChange: (i: number) => void;
  onSelect: (pr: PullRequestInfo) => void;
  selectedNumber?: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const els = listRef.current.querySelectorAll("[data-pr-item]");
    els[highlightIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [highlightIndex]);

  if (loading) {
    return (
      <div className="px-3 py-2 text-sm text-[var(--text-secondary)]" data-testid="pr-combobox-loading">
        {i18nT("status.loadingPullRequests", undefined, "Loading pull requests…")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-3 py-2 text-sm text-red-400" data-testid="pr-combobox-error">
        {error}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-[var(--text-secondary)]" data-testid="pr-combobox-empty">
        {i18nT("common.noOpenPullRequests", undefined, "No open pull requests")}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)]"
      style={{ maxHeight: 320 }}
      role="listbox"
    >
      {items.map((pr, i) => {
        const isHighlighted = i === highlightIndex;
        const isSelected = selectedNumber === pr.number;
        return (
          <div
            key={pr.number}
            data-pr-item
            role="option"
            aria-selected={isSelected}
            className={`px-3 py-1.5 flex items-center gap-2 text-sm cursor-pointer ${
              isHighlighted
                ? "bg-blue-600/30"
                : "hover:bg-[var(--bg-secondary)]"
            }`}
            onMouseEnter={() => onHighlightChange(i)}
            onClick={() => onSelect(pr)}
          >
            <span className="font-mono text-xs text-[var(--text-muted)] shrink-0">
              #{pr.number}
            </span>
            <span className="flex-1 truncate">{pr.title}</span>
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">
              @{pr.author}
            </span>
            <PrBadge pr={pr} />
          </div>
        );
      })}
    </div>
  );
}

function PrBadge({ pr }: { pr: PullRequestInfo }) {
  if (pr.isDraft) {
    return (
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-full px-1.5 py-px shrink-0">
        draft
      </span>
    );
  }
  if (pr.checkRollup === "passing") {
    return <span className="text-green-400 text-[10px] shrink-0" title={i18nT("common.ciPassing", undefined, "CI passing")}>●</span>;
  }
  if (pr.checkRollup === "failing") {
    return <span className="text-red-400 text-[10px] shrink-0" title={i18nT("common.ciFailing", undefined, "CI failing")}>●</span>;
  }
  if (pr.checkRollup === "pending") {
    return <span className="text-yellow-400 text-[10px] shrink-0" title={i18nT("common.ciPending", undefined, "CI pending")}>●</span>;
  }
  return null;
}
