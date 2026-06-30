/**
 * Scoped markdown file picker for the Instructions page.
 *
 * Lists the writable `.md`/`.mdx` candidates returned by
 * `GET /api/file/md-candidates` (directory scope = `cwd` present; global scope
 * = `cwd` omitted). Every candidate is server-guaranteed writable (picker ⊆
 * guard). No free-form path input — selection is constrained to the returned
 * set. Substring filter narrows by `relPath`.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import type { MdCandidate, MdCandidatesResponse } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../../lib/api-context.js";
import { t as i18nT } from "../../lib/i18n";

interface Props {
  cwd?: string;
  selectedPath: string | null;
  onSelect: (candidate: MdCandidate) => void;
  /** Fired once after candidates load successfully (drives default selection). */
  onLoaded?: (candidates: MdCandidate[]) => void;
}

export function FilePicker({ cwd, selectedPath, onSelect, onLoaded }: Props) {
  const [candidates, setCandidates] = useState<MdCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Keep the latest `onLoaded` in a ref so the fetch effect depends only on
  // `cwd`. `InstructionsPage` recreates `onLoaded` on every selection; depending
  // on its identity would refire the candidates fetch (and reset the picker to
  // loading) on every file click. See change (CodeRabbit): decouple fetch.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    let active = true;
    setCandidates(null);
    setError(null);
    const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    fetch(`${getApiBase()}/api/file/md-candidates${qs}`)
      .then((res) => res.json() as Promise<MdCandidatesResponse>)
      .then((body) => {
        if (!active) return;
        if (!body.success || !body.data) {
          setError(body.error ?? "Failed to load files");
          return;
        }
        setCandidates(body.data.candidates);
        onLoadedRef.current?.(body.data.candidates);
      })
      .catch((err) => active && setError(err?.message ?? "Network error"));
    return () => {
      active = false;
    };
  }, [cwd]);

  const filtered = useMemo(() => {
    if (!candidates) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.relPath.toLowerCase().includes(q));
  }, [candidates, filter]);

  return (
    <div
      data-testid="file-picker"
      className="flex flex-col w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-[var(--border-primary)] min-h-0"
    >
      {/* Scope chip */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
          {cwd
            ? i18nT("auto.directory", undefined, "directory")
            : i18nT("auto.global", undefined, "global")}
        </span>
      </div>

      {/* Filter */}
      <div className="px-2 py-2 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={i18nT("auto.filter_files", undefined, "Filter…")}
          className="w-full px-2 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {error && <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{error}</div>}
        {!error && candidates === null && (
          <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">
            {i18nT("auto.loading", undefined, "Loading…")}
          </div>
        )}
        {!error && candidates !== null && filtered.length === 0 && (
          <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">
            {candidates.length === 0
              ? i18nT("auto.no_markdown_files", undefined, "No markdown files")
              : i18nT("auto.no_matches", undefined, "No matches")}
          </div>
        )}
        {filtered.map((c) => {
          const active = c.path === selectedPath;
          return (
            <button
              type="button"
              key={c.path}
              data-testid="file-picker-item"
              onClick={() => onSelect(c)}
              aria-current={active ? "true" : undefined}
              title={c.relPath}
              className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono truncate transition-colors cursor-pointer ${
                active
                  ? "bg-blue-600/15 text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {c.relPath}
            </button>
          );
        })}
      </div>
    </div>
  );
}
