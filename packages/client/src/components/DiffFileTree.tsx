/**
 * DiffFileTree — two-level file tree showing changed files with expandable change events.
 */

import type { FileChangeEvent, FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { buildFileTree, type TreeNode } from "../lib/diff-tree.js";
import { t as i18nT } from "../lib/i18n";
import { CountBadges } from "./CountBadges.js";

export interface FileSelection {
  /** Selected file path */
  filePath: string;
  /** Selected change index within the file (null = file-level / aggregate) */
  changeIndex: number | null;
}

interface DiffFileTreeProps {
  files: FileDiffEntry[];
  selection: FileSelection | null;
  onSelect: (selection: FileSelection) => void;
  /** Aggregate additions (numstat, or summed per-turn deltas when `summed`). */
  totalAdditions?: number;
  /** Aggregate deletions (numstat, or summed per-turn deltas when `summed`). */
  totalDeletions?: number;
  /**
   * When true, the counts are summed per-turn event deltas (non-git session),
   * not git-net; the header flags them with a `summed` badge so the number is
   * never mistaken for git-net. See change: add-change-summary-table.
   */
  summed?: boolean;
}

export function DiffFileTree({
  files,
  selection,
  onSelect,
  totalAdditions,
  totalDeletions,
  summed = false,
}: DiffFileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const totalFiles = files.length;
  const hasTotals = totalAdditions !== undefined || totalDeletions !== undefined;

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Summary roll-up header: N files · +X −Y (· summed badge for non-git). */}
      <div className="px-3 py-2 border-b border-[var(--border-primary)] text-[var(--text-tertiary)] text-xs flex items-center gap-2">
        <span>
          {totalFiles} file{totalFiles !== 1 ? "s" : ""} changed
        </span>
        {hasTotals && (
          <>
            <span>·</span>
            <CountBadges additions={totalAdditions ?? 0} deletions={totalDeletions ?? 0} />
          </>
        )}
        {summed && (
          <span
            title={i18nT("auto.summed_badge_hint", undefined, "Summed per-turn deltas (non-git), not git-net")}
            className="ml-auto rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]"
          >
            {i18nT("auto.summed", undefined, "summed")}
          </span>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeNodeView
            key={node.path}
            node={node}
            depth={0}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  selection,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selection: FileSelection | null;
  onSelect: (selection: FileSelection) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.isDir) {
    return (
      <>
        <div
          className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-xs">{expanded ? "▾" : "▸"}</span>
          <span className="text-blue-400">📁</span>
          <span className="truncate">{node.name}</span>
        </div>
        {expanded &&
          node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  }

  // File node
  const file = node.file!;
  const isSelected = selection?.filePath === file.path && selection.changeIndex === null;
  const changeCount = file.changes.length;
  const hasEdits = file.changes.some((c) => c.type === "edit");
  const statusIndicator = hasEdits ? (
    <span className="text-yellow-400 text-xs font-bold" title={i18nT("auto.modified", undefined, "Modified")}>●</span>
  ) : (
    <span className="text-green-400 text-xs font-bold" title={i18nT("auto.added", undefined, "Added")}>+</span>
  );

  return (
    <FileNodeView
      node={node}
      file={file}
      depth={depth}
      isSelected={isSelected}
      changeCount={changeCount}
      statusIndicator={statusIndicator}
      selection={selection}
      onSelect={onSelect}
    />
  );
}

function FileNodeView({
  node,
  file,
  depth,
  isSelected,
  changeCount,
  statusIndicator,
  selection,
  onSelect,
}: {
  node: TreeNode;
  file: FileDiffEntry;
  depth: number;
  isSelected: boolean;
  changeCount: number;
  statusIndicator: React.ReactNode;
  selection: FileSelection | null;
  onSelect: (selection: FileSelection) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleFileClick = useCallback(() => {
    onSelect({ filePath: file.path, changeIndex: null });
    if (changeCount > 1) setExpanded((p) => !p);
  }, [file.path, changeCount, onSelect]);

  return (
    <>
      <div
        className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-tertiary)] ${
          isSelected ? "bg-[var(--bg-tertiary)]" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleFileClick}
      >
        {changeCount > 1 && (
          <span className="text-xs text-[var(--text-tertiary)]">
            {expanded ? "▾" : "▸"}
          </span>
        )}
        {statusIndicator}
        <span className="truncate flex-1">{node.name}</span>
        {(file.additions !== undefined || file.deletions !== undefined) && (
          <span className="text-[10px] shrink-0">
            <CountBadges additions={file.additions ?? 0} deletions={file.deletions ?? 0} />
          </span>
        )}
        {changeCount > 1 && (
          <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
            {changeCount}×
          </span>
        )}
      </div>

      {/* Expandable change events */}
      {expanded &&
        file.changes.map((change, idx) => (
          <ChangeEventNode
            key={idx}
            change={change}
            index={idx}
            filePath={file.path}
            depth={depth + 1}
            isSelected={selection?.filePath === file.path && selection.changeIndex === idx}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function ChangeEventNode({
  change,
  index,
  filePath,
  depth,
  isSelected,
  onSelect,
}: {
  change: FileChangeEvent;
  index: number;
  filePath: string;
  depth: number;
  isSelected: boolean;
  onSelect: (selection: FileSelection) => void;
}) {
  const timeStr = formatRelativeTime(change.timestamp);
  const icon = change.type === "edit" ? "✏️" : "📝";

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-tertiary)] text-xs ${
        isSelected ? "bg-[var(--bg-tertiary)]" : ""
      }`}
      style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
      onClick={() => onSelect({ filePath, changeIndex: index })}
    >
      <span>{icon}</span>
      <span className="text-[var(--text-tertiary)] shrink-0">{timeStr}</span>
      {change.message && (
        <span className="truncate text-[var(--text-secondary)]" title={change.message}>
          {change.message.length > 50 ? `${change.message.slice(0, 50)}…` : change.message}
        </span>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}
