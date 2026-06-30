/**
 * Lazy file-tree rail rooted at the session cwd. Directories expand one level
 * at a time; clicking a file opens it via the shared file-kind classifier.
 *
 * `/api/browse` lists directories only, so each expansion fetches the full
 * entry-name set from `/api/file` and intersects with `/api/browse` to mark
 * which entries are directories.
 *
 * See change: add-internal-monaco-editor-pane.
 */

import { fileKind, type ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiChevronDown, mdiChevronRight, mdiFileOutline, mdiFolderOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api-context.js";
import { browseDirectory } from "../../lib/browse-api.js";

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

/** List a directory's entries, marking which are directories. */
async function listDir(cwd: string, relDir: string): Promise<DirEntry[]> {
  const absDir = absOf(cwd, relDir);
  const [allNames, dirResult] = await Promise.all([
    fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(relDir || ".")}`)
      .then((r) => r.json())
      .then((b) => (b.success && b.data?.type === "directory" ? (b.data.entries as string[]) : []))
      .catch(() => [] as string[]),
    browseDirectory(absDir)
      .then((res) => new Set(res.entries.map((e) => e.name)))
      .catch(() => new Set<string>()),
  ]);
  return allNames
    .map((name) => ({ name, isDir: dirResult.has(name) }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
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

  useEffect(() => {
    let active = true;
    listDir(cwd, relDir).then((e) => active && setEntries(e));
    return () => {
      active = false;
    };
  }, [cwd, relDir]);

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
        return (
          <button
            key={rel}
            type="button"
            onClick={() => onOpenFile(rel, viewer)}
            className={[
              "flex w-full items-center gap-1 py-1 pr-2 text-left text-xs hover:bg-[var(--bg-hover)]",
              rel === activePath ? "bg-[var(--bg-selected)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
            ].join(" ")}
            style={{ paddingLeft: pad + 10 }}
          >
            <Icon path={mdiFileOutline} size={0.55} />
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
