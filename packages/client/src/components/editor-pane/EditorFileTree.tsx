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
import { mdiCheck, mdiChevronDown, mdiChevronRight, mdiContentCopy, mdiFolderOutline } from "@mdi/js";
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
const baseName = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);

/**
 * Hover-revealed copy affordance on a tree row. The glyph opens an anchored
 * popup offering full/relative/name copy actions. Clipboard writes are guarded
 * (silent no-op when unavailable), matching `CopyButton`.
 */
function RowCopyAffordance({ cwd, rel }: { cwd: string; rel: string }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const glyphRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    setOpen(false);
    setCopied(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popupRef.current?.contains(t) && !glyphRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        glyphRef.current?.focus();
      }
    };
    const onScroll = () => close();
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    // Capture: catches scroll from the rail container (scroll does not bubble).
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      close();
      return;
    }
    // Flip above the glyph when a ~100px popup would overflow the rail bottom.
    const rail = glyphRef.current?.closest("[data-file-rail]");
    const rect = glyphRef.current?.getBoundingClientRect();
    const bottom = rail ? rail.getBoundingClientRect().bottom : window.innerHeight;
    setFlip(!!rect && rect.bottom + 100 > bottom);
    setOpen(true);
  };

  const doCopy = (key: string, payload: string) => {
    try {
      // writeText returns a Promise; swallow async rejection (permission/policy
      // denied) too so the action fails silently, matching CopyButton. Optional
      // chaining short-circuits the whole chain when clipboard is unavailable.
      navigator.clipboard?.writeText(payload).catch(() => {});
    } catch {
      // Clipboard API unavailable — fail silently.
    }
    setCopied(key);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, 1500);
  };

  const abs = absOf(cwd, rel);
  const items: Array<{ key: string; label: string; payload: string }> = [
    { key: "full", label: "Copy full path", payload: abs },
    { key: "rel", label: "Copy relative path", payload: rel },
    { key: "name", label: "Copy file name", payload: baseName(rel) },
  ];

  return (
    <div className="relative flex-none">
      <button
        type="button"
        ref={glyphRef}
        aria-label="Copy path"
        title="Copy path"
        onClick={toggle}
        className={[
          "mr-1 rounded p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-opacity",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        ].join(" ")}
      >
        <Icon path={mdiContentCopy} size={0.55} />
      </button>
      {open && (
        <div
          ref={popupRef}
          role="menu"
          className={[
            "absolute right-1 z-20 min-w-[190px] overflow-hidden rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg",
            flip ? "bottom-full mb-1" : "top-full mt-1",
          ].join(" ")}
        >
          <div
            className="truncate border-b border-[var(--border-primary)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
            title={abs}
          >
            {abs}
          </div>
          {items.map((it) => (
            <button
              type="button"
              key={it.key}
              role="menuitem"
              onClick={() => doCopy(it.key, it.payload)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <span>{it.label}</span>
              {copied === it.key && <Icon path={mdiCheck} size={0.55} className="text-green-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
              <div
                data-row={rel}
                className="group relative flex items-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <button
                  type="button"
                  onClick={() => onToggleRoot(rel)}
                  className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs"
                  style={{ paddingLeft: pad }}
                >
                  <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.5} />
                  <Icon path={mdiFolderOutline} size={0.55} />
                  <span className="truncate">{entry.name}</span>
                </button>
                <RowCopyAffordance cwd={cwd} rel={rel} />
              </div>
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
          <div
            key={rel}
            data-row={rel}
            className={[
              "group relative flex items-center hover:bg-[var(--bg-hover)]",
              isActive ? "bg-[var(--bg-selected)]" : "",
            ].join(" ")}
          >
            <button
              type="button"
              ref={isActive ? activeRowRef : undefined}
              onClick={() => onOpenFile(rel, viewer)}
              className={[
                "flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs",
                isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
              ].join(" ")}
              style={{ paddingLeft: pad + 10 }}
            >
              <Icon path={icon.iconPath} size={0.55} className={icon.colorClass} />
              <span className="truncate">{entry.name}</span>
            </button>
            <RowCopyAffordance cwd={cwd} rel={rel} />
          </div>
        );
      })}
    </>
  );
}

export function EditorFileTree(props: EditorFileTreeProps) {
  return (
    <div
      data-file-rail=""
      className="h-full overflow-auto border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]"
    >
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
