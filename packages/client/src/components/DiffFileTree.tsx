/**
 * DiffFileTree — two-level file tree showing changed files with expandable change events.
 */
import React, { useState, useMemo, useCallback } from "react";
import type { FileDiffEntry, FileChangeEvent } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { buildFileTree, type TreeNode } from "../lib/diff-tree.js";
import { t as i18nT } from "../lib/i18n";

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
}

export function DiffFileTree({ files, selection, onSelect }: DiffFileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const totalFiles = files.length;

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Summary */}
      <div className="px-3 py-2 border-b border-[var(--border-primary)] text-[var(--text-tertiary)] text-xs">
        {totalFiles} file{totalFiles !== 1 ? "s" : ""} changed
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
          {change.message.length > 50 ? change.message.slice(0, 50) + "…" : change.message}
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
