/**
 * Lazy file-tree rail rooted at the session cwd. Directories expand one level
 * at a time; clicking a file opens it via the shared file-kind classifier.
 *
 * Entries come from a single `GET /api/file/tree` call
 * (`readdir(withFileTypes)`, hidden INCLUDED) — the single source of truth for
 * `{ name, isDir }`. Replaces the old `/api/file`(names)+`/api/browse`(dirs,
 * hidden-stripped) merge that mislabelled `.git`/`.pi` as files (#1).
 *
 * See change: add-internal-monaco-editor-pane.
 * See change: improve-content-editor (tree correctness #1, mime icons #2).
 */

import { fileKind, type ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiChevronDown, mdiChevronRight, mdiFolderOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../../lib/api-context.js";
import { fileIcon } from "../../lib/file-icon.js";

interface EditorFileTreeProps {
  cwd: string;
  treeOpenRoots: string[];
  onToggleRoot: (relPath: string) => void;
  onOpenFile: (relPath: string, viewer: ViewerKind) => void;
  activePath: string | null;
}

interface DirEntry {
  name: string;
  isDir: boolean;
}

const joinRel = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

/** List a directory's entries (name + isDir) from the single tree endpoint. */
async function listDir(cwd: string, relDir: string): Promise<DirEntry[]> {
  return fetch(
    `${getApiBase()}/api/file/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(relDir || ".")}`,
  )
    .then((r) => r.json())
    .then((b) => (b.success ? (b.data.entries as DirEntry[]) : []))
    .catch(() => [] as DirEntry[]);
}

function TreeNode({
  cwd,
  relDir,
  depth,
  treeOpenRoots,
  onToggleRoot,
  onOpenFile,
  activePath,
}: {
  cwd: string;
  relDir: string;
  depth: number;
} & Omit<EditorFileTreeProps, "cwd">) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  // Ref on the active row so it can be scrolled into view when it (re)mounts
  // or when the active tab changes (#5).
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    listDir(cwd, relDir).then((e) => active && setEntries(e));
    return () => {
      active = false;
    };
  }, [cwd, relDir]);

  // Reveal the active row once entries render (or activePath changes).
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries, activePath]);

  if (entries === null) {
    return <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]" style={{ paddingLeft: depth * 12 + 8 }}>Loading…</div>;
  }

  return (
    <>
      {entries.map((entry) => {
        const rel = joinRel(relDir, entry.name);
        const open = treeOpenRoots.includes(rel);
        const pad = depth * 12 + 8;
        if (entry.isDir) {
          return (
            <div key={rel}>
              <button
                type="button"
                onClick={() => onToggleRoot(rel)}
                className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                style={{ paddingLeft: pad }}
              >
                <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.5} />
                <Icon path={mdiFolderOutline} size={0.55} />
                <span className="truncate">{entry.name}</span>
              </button>
              {open && (
                <TreeNode
                  cwd={cwd}
                  relDir={rel}
                  depth={depth + 1}
                  treeOpenRoots={treeOpenRoots}
                  onToggleRoot={onToggleRoot}
                  onOpenFile={onOpenFile}
                  activePath={activePath}
                />
              )}
            </div>
          );
        }
        const viewer = fileKind(absOf(cwd, rel)).viewer;
        const icon = fileIcon(entry.name);
        const isActive = rel === activePath;
        return (
          <button
            key={rel}
            type="button"
            ref={isActive ? activeRowRef : undefined}
            onClick={() => onOpenFile(rel, viewer)}
            className={[
              "flex w-full items-center gap-1 py-1 pr-2 text-left text-xs hover:bg-[var(--bg-hover)]",
              rel === activePath ? "bg-[var(--bg-selected)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
            ].join(" ")}
            style={{ paddingLeft: pad + 10 }}
          >
            <Icon path={icon.iconPath} size={0.55} className={icon.colorClass} />
            <span className="truncate">{entry.name}</span>
          </button>
        );
      })}
    </>
  );
}

export function EditorFileTree(props: EditorFileTreeProps) {
  return (
    <div className="h-full overflow-auto border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <TreeNode
        cwd={props.cwd}
        relDir=""
        depth={0}
        treeOpenRoots={props.treeOpenRoots}
        onToggleRoot={props.onToggleRoot}
        onOpenFile={props.onOpenFile}
        activePath={props.activePath}
      />
    </div>
  );
}
