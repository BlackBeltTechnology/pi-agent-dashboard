/**
 * Scoped markdown file picker for the Instructions page.
 *
 * Lists the writable `.md`/`.mdx` candidates returned by
 * `GET /api/file/md-candidates` (directory scope = `cwd` present; global scope
 * = `cwd` omitted). Every candidate is server-guaranteed writable (picker ⊆
 * guard). No free-form path input — selection is constrained to the returned
 * set. Substring filter narrows by `relPath`.
 *
 * Candidates fold into a collapsible folder tree (`buildTree`): directories
 * nest with chevron rows, files show only their basename. Collapse state
 * defaults to expanded and persists to `localStorage` (only collapsed paths
 * stored, so new folders default expanded). An active filter keeps a directory
 * visible when any descendant matches and force-expands the branch. The tree
 * column width is owned by `InstructionsPage` via the `width` prop (mobile =
 * full width / undefined).
 *
 * See change: directory-settings-tree-and-resize (tree + resize + mobile).
 * See change: directory-settings-page-and-scoped-md-editing (original picker).
 */
import type { MdCandidate, MdCandidatesResponse } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiChevronDown, mdiChevronRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildTree, type FileLeaf, subtreeMatches, type TreeNode } from "./file-tree.js";

const COLLAPSED_KEY = "dashboard:dirset-collapsed";

/** Read the persisted collapsed-dir set; degrade to empty on any throw. */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Persist the collapsed-dir set; a throw (private mode) degrades to in-memory. */
function writeCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* noop — keep in-memory state */
  }
}

/** One collapsible directory row (chevron + name, indented by depth). */
function DirRow({
  node,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  collapsed: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="file-picker-dir"
      aria-expanded={!collapsed}
      onClick={() => onToggle(node.path)}
      style={{ paddingLeft: 8 + depth * 16 }}
      className="flex items-center gap-1 w-full text-left min-h-[44px] md:min-h-0 py-1.5 pr-2 rounded text-xs font-mono text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
    >
      <Icon
        path={collapsed ? mdiChevronRight : mdiChevronDown}
        size={0.5}
        className="shrink-0 text-[var(--text-tertiary)]"
      />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

/** One file leaf row (basename only), preserving `onSelect` + active state. */
function FileRow({
  leaf,
  depth,
  active,
  onSelect,
}: {
  leaf: FileLeaf;
  depth: number;
  active: boolean;
  onSelect: (candidate: MdCandidate) => void;
}) {
  return (
    <button
      type="button"
      data-testid="file-picker-item"
      onClick={() => onSelect(leaf.candidate)}
      aria-current={active ? "true" : undefined}
      title={leaf.candidate.relPath}
      style={{ paddingLeft: 8 + depth * 16 + 20 }}
      className={`flex items-center w-full text-left min-h-[44px] md:min-h-0 py-1.5 pr-2 rounded text-xs font-mono truncate transition-colors cursor-pointer ${
        active
          ? "bg-blue-600/15 text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"
      }`}
    >
      <span className="truncate">{leaf.name}</span>
    </button>
  );
}

interface Props {
  cwd?: string;
  selectedPath: string | null;
  onSelect: (candidate: MdCandidate) => void;
  /** Fired once after candidates load successfully (drives default selection). */
  onLoaded?: (candidates: MdCandidate[]) => void;
  /** Desktop column width in px. `undefined` ⇒ full width (mobile master/detail). */
  width?: number;
}

export function FilePicker({ cwd, selectedPath, onSelect, onLoaded, width }: Props) {
  const [candidates, setCandidates] = useState<MdCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed());

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      writeCollapsed(next);
      return next;
    });
  }, []);

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

  const tree = useMemo(() => buildTree(candidates ?? []), [candidates]);
  const q = filter.trim().toLowerCase();
  const hasMatches = q
    ? tree.dirs.some((d) => subtreeMatches(d, q)) ||
      tree.files.some((f) => f.candidate.relPath.toLowerCase().includes(q))
    : (candidates?.length ?? 0) > 0;

  /**
   * Recursively render tree rows. Directories fold with a chevron + `depth*16px`
   * indent (idiom borrowed from `resource-tree.tsx`); files render their
   * basename and preserve `onSelect` + active state. While filtering, a branch
   * with any matching descendant is force-expanded regardless of persisted
   * collapse state.
   */
  function renderDir(dir: TreeNode, depth: number): ReactNode[] {
    if (q && !subtreeMatches(dir, q)) return [];
    const isCollapsed = !q && collapsed.has(dir.path);
    const row = (
      <DirRow key={`dir:${dir.path}`} node={dir} depth={depth} collapsed={isCollapsed} onToggle={toggleDir} />
    );
    return isCollapsed ? [row] : [row, ...renderNode(dir, depth + 1)];
  }

  function renderNode(node: TreeNode, depth: number): ReactNode[] {
    return [
      ...node.dirs.flatMap((dir) => renderDir(dir, depth)),
      ...node.files
        .filter((leaf) => !q || leaf.candidate.relPath.toLowerCase().includes(q))
        .map((leaf) => (
          <FileRow
            key={leaf.candidate.path}
            leaf={leaf}
            depth={depth}
            active={leaf.candidate.path === selectedPath}
            onSelect={onSelect}
          />
        )),
    ];
  }

  return (
    <div
      data-testid="file-picker"
      style={width != null ? { width } : undefined}
      className={`flex flex-col shrink-0 border-b md:border-b-0 md:border-r border-[var(--border-primary)] min-h-0 ${
        width == null ? "w-full" : ""
      }`}
    >
      {/* Scope chip */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
          {cwd
            ? i18nT("folders.directory", undefined, "directory")
            : i18nT("common.global", undefined, "global")}
        </span>
      </div>

      {/* Filter */}
      <div className="px-2 py-2 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={i18nT("common.filterFiles", undefined, "Filter…")}
          className="w-full px-2 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {error && <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{error}</div>}
        {!error && candidates === null && (
          <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">
            {i18nT("common.loading2", undefined, "Loading…")}
          </div>
        )}
        {!error && candidates !== null && !hasMatches && (
          <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">
            {candidates.length === 0
              ? i18nT("common.noMarkdownFiles", undefined, "No markdown files")
              : i18nT("common.noMatches", undefined, "No matches")}
          </div>
        )}
        {!error && candidates !== null && renderNode(tree, 0)}
      </div>
    </div>
  );
}
