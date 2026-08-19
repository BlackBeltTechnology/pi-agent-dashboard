/**
 * Shared worktree list, rendered in two modes.
 *
 *   `mode="spawn"`  — whole-row `<button>`; clicking spawns a session in that
 *                     worktree (the surface `WorktreeSpawnDialog` §1 used to
 *                     own inline).
 *   `mode="manage"` — non-button row (design D9) hosting a selection checkbox
 *                     and a `✕` remove control; the row container must never be
 *                     a `<button>` because interactive elements cannot nest.
 *
 * Filtering is entirely client-side and derived from fields already on the wire
 * (design D1): the default predicate is `isMain || (!detached && inTree)`, and
 * `inTree` comes from the main entry's own path with `\` → `/` normalisation —
 * without which every row on Windows classifies out-of-tree and the default view
 * collapses to the main row alone.
 *
 * Every hidden row is revealable by at least one chip, and the `N of M shown`
 * count is a UNION, not a sum of chip counts — a row can be both detached and
 * out-of-tree (design D2).
 *
 * Row text uses `--text-primary` (branch) and `--text-secondary` (path) only:
 * `--text-muted` fails AA on dark and `--text-tertiary` fails on light, so
 * neither may carry row text (design D6).
 *
 * See change: manage-worktrees-filter-cleanup.
 */

import { slugifyBranch } from "@blackbelt-technology/pi-dashboard-shared/git-worktree-helpers.js";
import React, { useMemo, useState } from "react";
import type { WorktreeEntry } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

// ── path helpers ───────────────────────────────────────────────────

/** Normalise Windows separators so every path predicate is comparable. */
export function normalisePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function basenameOf(p: string): string {
  const n = normalisePath(p);
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

/** True when `path` sits under `<main>/.worktrees/`. */
export function isInTree(path: string, mainPath: string | null): boolean {
  if (!mainPath) return false;
  return normalisePath(path).startsWith(`${normalisePath(mainPath)}/.worktrees/`);
}

/**
 * Suppress the path line only when it restates the branch (design D7).
 * The `inTree` gate is load-bearing: an out-of-tree `pathOverride` row whose
 * basename matches by coincidence must still show its path, because the path
 * is that row's only unique key. `branch != null` guards detached/bare rows,
 * where `slugifyBranch(null)` would throw.
 */
export function suppressPathLine(entry: WorktreeEntry, mainPath: string | null): boolean {
  if (!isInTree(entry.path, mainPath)) return false;
  if (entry.branch == null) return false;
  return basenameOf(entry.path) === slugifyBranch(entry.branch);
}

/**
 * Elide a long path in JS, by SEGMENT. Never CSS `direction: rtl` — bidi
 * reordering relocates leading punctuation and renders `.worktrees/x` as
 * `worktrees/x.`, corrupting the identifier the user reads (design D7).
 */
export function elidePath(path: string, maxLen = 48): string {
  const n = normalisePath(path);
  if (n.length <= maxLen) return n;
  const segments = n.split("/");
  if (segments.length <= 2) return n;
  const last = segments[segments.length - 1];
  const first = segments[0] === "" ? "/" : segments[0];
  let out = `${first}/…/${last}`;
  // Grow back from the tail while it still fits, always on a segment boundary.
  for (let i = segments.length - 2; i > 0; i--) {
    const tail = segments.slice(i).join("/");
    const candidate = `${first}/…/${tail}`;
    if (candidate.length > maxLen) break;
    out = candidate;
  }
  return out;
}

/** The constant `.worktrees/` prefix carries no per-row information. */
export function stripWorktreesPrefix(path: string, mainPath: string | null): string {
  if (!mainPath) return normalisePath(path);
  const prefix = `${normalisePath(mainPath)}/.worktrees/`;
  const n = normalisePath(path);
  return n.startsWith(prefix) ? n.slice(prefix.length) : n;
}

// ── filtering ──────────────────────────────────────────────────────

export interface RowModel {
  entry: WorktreeEntry;
  inTree: boolean;
  /** `exists === false` exactly — `undefined` means "unknown, treat as present". */
  missing: boolean;
}

export function buildRows(entries: WorktreeEntry[]): { rows: RowModel[]; mainPath: string | null } {
  const mainPath = entries.find((e) => e.isMain)?.path ?? null;
  const rows = entries.map((entry) => ({
    entry,
    inTree: isInTree(entry.path, mainPath),
    missing: entry.exists === false,
  }));
  return { rows, mainPath };
}

/** Default predicate: `isMain || (!detached && inTree)` (design D2). */
export function matchesDefault(row: RowModel): boolean {
  return row.entry.isMain || (!row.entry.detached && row.inTree);
}

export interface Reveal {
  detached: boolean;
  outOfTree: boolean;
}

export function isVisible(row: RowModel, reveal: Reveal, query: string): boolean {
  // An explicit text query searches EVERY entry and overrides the default
  // predicate — otherwise searching for a hidden row silently returns nothing.
  if (query.trim() !== "") {
    const q = query.trim().toLowerCase();
    // `branch` is nullable on detached/bare rows — never call a string method
    // on it unguarded.
    const haystack = `${row.entry.path} ${row.entry.branch ?? ""}`.toLowerCase();
    return haystack.includes(q);
  }
  if (matchesDefault(row)) return true;
  if (reveal.detached && row.entry.detached) return true;
  if (reveal.outOfTree && !row.inTree) return true;
  return false;
}

/** Rows hidden by default, per axis. A dual-group row is counted by BOTH. */
export function hiddenCounts(rows: RowModel[]): { detached: number; outOfTree: number } {
  const hidden = rows.filter((r) => !matchesDefault(r));
  return {
    detached: hidden.filter((r) => r.entry.detached).length,
    outOfTree: hidden.filter((r) => !r.inTree).length,
  };
}

// ── component ──────────────────────────────────────────────────────

export interface WorktreeListProps {
  entries: WorktreeEntry[];
  mode: "spawn" | "manage";
  /** spawn mode — one-click spawn for a row. */
  onSpawn?: (path: string, entry: WorktreeEntry) => void;
  /** manage mode — per-row remove (`✕`). */
  onRemove?: (entry: WorktreeEntry) => void;
  /** manage mode — repo-global prune. */
  onPrune?: () => void;
  /** manage mode — bulk removal of the current selection. */
  onRemoveSelected?: (paths: string[], opts: { deleteBranch: boolean }) => void;
  /** manage mode — per-row failure strips, keyed by worktree path. */
  failures?: Record<string, { code: string; message?: string; onRetry?: () => void }>;
  /** manage mode — rows whose removal is in flight. */
  pending?: string[];
}

export function WorktreeList({
  entries,
  mode,
  onSpawn,
  onRemove,
  onPrune,
  onRemoveSelected,
  failures,
  pending,
}: WorktreeListProps) {
  const [reveal, setReveal] = useState<Reveal>({ detached: false, outOfTree: false });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteBranch, setDeleteBranch] = useState(false);

  const { rows, mainPath } = useMemo(() => buildRows(entries), [entries]);
  const visible = useMemo(() => rows.filter((r) => isVisible(r, reveal, query)), [rows, reveal, query]);
  const counts = useMemo(() => hiddenCounts(rows), [rows]);

  const anyMissing = rows.some((r) => r.missing);
  /** The main row and vanished rows are never selectable or removable. */
  const selectable = visible.filter((r) => !r.entry.isMain && !r.missing);
  const selectedSet = new Set(selected);
  const pendingSet = new Set(pending ?? []);

  const toggle = (path: string) =>
    setSelected((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));

  const selectAllShown = () => setSelected(selectable.map((r) => r.entry.path));

  const chip = (key: "detached" | "outOfTree", count: number, label: string) => {
    if (count === 0) return null;
    const on = reveal[key];
    return (
      <button
        type="button"
        key={key}
        data-testid={`worktree-chip-${key}`}
        aria-pressed={on}
        onClick={() => setReveal((r) => ({ ...r, [key]: !r[key] }))}
        className="text-[11px] rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] min-h-[24px]"
      >
        {/* The sign states the ACTION so the number cannot be misread as
            "N are currently shown" (design D2). */}
        {on ? "−" : "+"} {label} {count}
      </button>
    );
  };

  return (
    <div data-testid={`worktree-list-${mode}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="worktree-filter-query"
          aria-label={i18nT("worktree.filterWorktrees", undefined, "Filter worktrees")}
          placeholder={i18nT("worktree.filterWorktrees", undefined, "Filter worktrees")}
          className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-2 py-1 flex-1 min-w-[8rem] text-[var(--text-primary)]"
        />
        {chip("detached", counts.detached, i18nT("worktree.detached", undefined, "detached"))}
        {chip("outOfTree", counts.outOfTree, i18nT("worktree.outOfTree", undefined, "out of tree"))}
        <span className="text-[11px] text-[var(--text-secondary)]" data-testid="worktree-shown-count">
          {visible.length} {i18nT("common.of", undefined, "of")} {rows.length}{" "}
          {i18nT("common.shown", undefined, "shown")}
        </span>
      </div>

      <div className="rounded border border-[var(--border-subtle)] overflow-hidden">
        {visible.map((row) => {
          const { entry } = row;
          const testId = `worktree-row-${entry.isMain ? "main" : encodeURIComponent(entry.path)}`;
          const branchLabel = entry.detached
            ? i18nT("worktree.detachedParen", undefined, "(detached)")
            : (entry.branch ?? i18nT("worktree.noBranch", undefined, "(none)"));
          const showPath = !suppressPathLine(entry, mainPath);
          const pathLabel = elidePath(stripWorktreesPrefix(entry.path, mainPath));
          const failure = failures?.[entry.path];

          const identity = (
            <>
              <span className="text-xs text-[var(--text-primary)] truncate">{branchLabel}</span>
              {entry.isMain && (
                <span className="ml-2 text-[9px] uppercase tracking-wider text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-full px-1.5 py-px">
                  {i18nT("worktree.main", undefined, "main")}
                </span>
              )}
              {row.missing && (
                <span className="ml-2 text-[9px] uppercase tracking-wider text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-full px-1.5 py-px" data-testid="worktree-row-missing">
                  {i18nT("worktree.missing", undefined, "missing")}
                </span>
              )}
            </>
          );

          if (mode === "spawn") {
            return (
              <button
                key={entry.path}
                type="button"
                data-testid={testId}
                onClick={() => onSpawn?.(entry.path, entry)}
                className="w-full text-left px-3 py-2 hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] last:border-b-0"
              >
                <div className="flex items-center">{identity}</div>
                {showPath && (
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">{pathLabel}</div>
                )}
              </button>
            );
          }

          // Manage mode: a plain container, NOT a <button> — a checkbox and a ✕
          // cannot legally nest inside one (design D9).
          return (
            <div
              key={entry.path}
              data-testid={testId}
              className="flex items-start gap-2 px-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0"
            >
              {!entry.isMain && !row.missing && (
                <input
                  type="checkbox"
                  data-testid={`worktree-select-${encodeURIComponent(entry.path)}`}
                  aria-label={i18nT("worktree.selectWorktree", undefined, "Select worktree")}
                  checked={selectedSet.has(entry.path)}
                  onChange={() => toggle(entry.path)}
                  className="mt-0.5 min-w-[24px] min-h-[24px] sm:min-w-[24px] max-sm:min-w-[44px] max-sm:min-h-[44px]"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center">{identity}</div>
                {showPath && (
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">{pathLabel}</div>
                )}
                {failure && (
                  // Cause + recovery conveyed by icon + text + border, never colour alone.
                  <div
                    data-testid={`worktree-row-failure-${encodeURIComponent(entry.path)}`}
                    className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1"
                  >
                    <span aria-hidden="true">⚠</span>
                    <span>{failure.message ?? failure.code}</span>
                    {failure.onRetry && (
                      <button
                        type="button"
                        onClick={failure.onRetry}
                        className="underline min-h-[24px]"
                        data-testid={`worktree-row-retry-${encodeURIComponent(entry.path)}`}
                      >
                        {i18nT("common.retry", undefined, "Retry")}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {row.missing ? (
                <button
                  type="button"
                  onClick={onPrune}
                  data-testid={`worktree-prune-${encodeURIComponent(entry.path)}`}
                  className="text-[11px] text-[var(--text-secondary)] underline min-h-[24px] max-sm:min-h-[44px]"
                >
                  {i18nT("worktree.pruneStaleRegistrations", undefined, "Prune stale registrations")}
                </button>
              ) : entry.isMain ? null : (
                <button
                  type="button"
                  onClick={() => onRemove?.(entry)}
                  disabled={pendingSet.has(entry.path)}
                  data-testid={`worktree-remove-${encodeURIComponent(entry.path)}`}
                  aria-label={i18nT("worktree.removeWorktree", undefined, "Remove worktree")}
                  className="text-[var(--text-secondary)] min-w-[24px] min-h-[24px] max-sm:min-w-[44px] max-sm:min-h-[44px] disabled:opacity-60"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {mode === "manage" && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={selectAllShown}
            data-testid="worktree-select-all"
            className="text-[11px] text-[var(--text-secondary)] underline min-h-[24px]"
          >
            {i18nT("worktree.selectAllShown", undefined, "Select all")} {selectable.length}{" "}
            {i18nT("common.shown", undefined, "shown")}
          </button>
          <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
              data-testid="worktree-delete-branch"
              className="min-w-[24px] min-h-[24px]"
            />
            {i18nT("worktree.deleteBranchToo", undefined, "Delete branch too")}
          </label>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onRemoveSelected?.(selected, { deleteBranch })}
              data-testid="worktree-remove-selected"
              className="text-xs text-[var(--text-primary)] border border-[var(--border-subtle)] rounded px-2 py-1 min-h-[24px]"
            >
              {i18nT("worktree.removeNWorktrees", undefined, "Remove")} {selected.length}{" "}
              {i18nT("worktree.worktrees", undefined, "worktrees")}
            </button>
          )}
          {(anyMissing || onPrune) && (
            <button
              type="button"
              onClick={onPrune}
              data-testid="worktree-prune-footer"
              className="text-[11px] text-[var(--text-secondary)] underline min-h-[24px] ml-auto"
            >
              {/* Repo-global, and the copy must say so (design D8). */}
              {i18nT(
                "worktree.pruneStaleRegistrationsRepoWide",
                undefined,
                "Prune stale registrations (clears every stale registration in this repo)",
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
