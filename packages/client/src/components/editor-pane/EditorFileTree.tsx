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

import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { fileKind, type ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiCheck, mdiChevronDown, mdiChevronRight, mdiDotsHorizontal, mdiDownload, mdiFolderOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { fetchWithoutGrantPrompt } from "../../lib/access-grants/grant-channel.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT, useI18n } from "../../lib/i18n/i18n.js";
import { fileIcon } from "../../lib/preview/file-icon.js";
import { logRejection } from "../../lib/report-error.js";
import { copyText } from "../../lib/util/clipboard.js";
import { useOptionalSessionDiff } from "../diff/SessionDiffContext.js";
import { useDownload } from "../preview/use-download.js";
import { CountBadges } from "../session/CountBadges.js";
import { MenuItem, MenuPopover } from "./MenuPopover.js";

interface EditorFileTreeProps {
  cwd: string;
  treeOpenRoots: string[];
  onToggleRoot: (relPath: string) => void;
  onOpenFile: (relPath: string, viewer: ViewerKind) => void;
  activePath: string | null;
  /** Opens the file's `diff:` tab (hover chip on a changed row). Optional. */
  onOpenDiff?: (relPath: string) => void;
  /** When true, hides the other-working-tree-changes bottom group. */
  sessionOnly?: boolean;
}

/** Session-owned changed files, indexed for O(1) row lookup (D1). */
interface DiffIndex {
  /** rel path → its FileDiffEntry (session-owned, on-disk). */
  files: Map<string, FileDiffEntry>;
  /** dir rel paths that contain a changed descendant (folder dots). */
  dirs: Set<string>;
}

function buildDiffIndex(files: FileDiffEntry[]): DiffIndex {
  const map = new Map<string, FileDiffEntry>();
  const dirs = new Set<string>();
  for (const f of files) {
    map.set(f.path, f);
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return { files: map, dirs };
}

/** Modified (edit / tool-detected) → `●`; pure add (write) → `+`. */
function statusIndicator(file: FileDiffEntry): React.ReactNode {
  const modified =
    file.changes.some((c) => c.type === "edit" || c.type === "tool") ||
    file.origin === "tool" ||
    file.origin === "mixed";
  return modified ? (
    <span data-testid="status-modified" className="text-yellow-400 text-xs font-bold" title={i18nT("common.modified", undefined, "Modified")}>●</span>
  ) : (
    <span data-testid="status-added" className="text-green-400 text-xs font-bold" title={i18nT("common.added", undefined, "Added")}>+</span>
  );
}

function relTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

interface DirEntry {
  name: string;
  isDir: boolean;
}

const joinRel = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);
const baseName = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);

/** Starts a download of the file at `rel` (set once by `EditorFileTree`; rows are in-cwd). */
const RowDownloadContext = createContext<(rel: string) => void>(() => {});

/** Open/close state of one row's actions menu, shared by the row and its glyph. */
function useRowMenu() {
  const [shown, setShown] = useState<{ returnTo?: HTMLElement } | null>(null);
  const glyphRef = useRef<HTMLButtonElement | null>(null);
  return {
    glyphRef,
    isOpen: shown !== null,
    returnTo: shown?.returnTo,
    /** `returnTo` = element Escape refocuses (default: the glyph). */
    show: (returnTo?: HTMLElement) => setShown({ returnTo }),
    hide: () => setShown(null),
    toggle: () => setShown((cur) => (cur ? null : {})),
  };
}
type RowMenu = ReturnType<typeof useRowMenu>;

/**
 * Row-container handlers that open the actions menu: secondary click, and the
 * `ContextMenu` key / Shift+F10 on the focused row button (mirrors
 * `EditorTabs`). Events re-bubbling from the portaled menu are ignored.
 */
function rowMenuTriggers(menu: RowMenu) {
  return {
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.target as Node)) return;
      e.preventDefault();
      menu.show();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.target as Node)) return;
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        menu.show(e.target as HTMLElement);
      }
    },
  };
}

/**
 * Row actions: a glyph (always visible on hover-less devices) opening a
 * `MenuPopover` — full / relative / name copy, plus Download on file rows.
 * The menu also opens from the row via `rowMenuTriggers`. It closes on any
 * scroll (the rail scrolls under a fixed popup). Clipboard writes are guarded
 * (silent no-op when unavailable), matching `CopyButton`.
 *
 * See change: add-file-download (replaces the copy-path popup).
 */
function RowActionsMenu({ cwd, rel, isDir, menu }: { cwd: string; rel: string; isDir: boolean; menu: RowMenu }) {
  const { t } = useI18n();
  const download = useContext(RowDownloadContext);
  const [copied, setCopied] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isOpen, hide } = menu;

  const close = () => {
    hide();
    setCopied(null);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onScroll = () => {
      hide();
      setCopied(null);
    };
    // Capture: catches scroll from the rail container (scroll does not bubble).
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [isOpen, hide]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const doCopy = (key: string, payload: string) => {
    // copyText never rejects: an unavailable/denied clipboard fails silently,
    // matching CopyButton.
    void copyText(payload);
    setCopied(key);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, 1500);
  };

  const abs = absOf(cwd, rel);
  const items: Array<{ key: string; label: string; payload: string }> = [
    { key: "full", label: t("editor.copyFullPath", undefined, "Copy full path"), payload: abs },
    { key: "rel", label: t("editor.copyRelativePath", undefined, "Copy relative path"), payload: rel },
    { key: "name", label: t("editor.copyFileName", undefined, "Copy file name"), payload: baseName(rel) },
  ];
  const label = t("editor.rowActions", undefined, "Row actions");
  const glyph = menu.glyphRef.current;

  return (
    <div className="relative flex-none">
      <button
        type="button"
        ref={menu.glyphRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) close();
          else menu.toggle();
        }}
        className={[
          "mr-1 rounded p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-opacity",
          isOpen
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        ].join(" ")}
      >
        <Icon path={mdiDotsHorizontal} size={0.55} />
      </button>
      {isOpen && glyph && (
        <MenuPopover anchorEl={glyph} returnFocusTo={menu.returnTo} label={label} testId="tree-row-menu" onClose={close}>
          <div
            className="truncate border-b border-[var(--border-primary)] px-3 py-1 text-[10px] text-[var(--text-tertiary)]"
            title={abs}
          >
            {abs}
          </div>
          {items.map((it) => (
            <MenuItem
              key={it.key}
              label={it.label}
              onSelect={() => doCopy(it.key, it.payload)}
              trailing={copied === it.key ? <Icon path={mdiCheck} size={0.55} className="text-green-500" /> : null}
            />
          ))}
          {!isDir && (
            <MenuItem
              testId="tree-row-download"
              label={
                <span className="inline-flex items-center gap-2">
                  <Icon path={mdiDownload} size={0.55} />
                  {t("common.download", undefined, "Download")}
                </span>
              }
              onSelect={() => {
                close();
                download(rel);
              }}
            />
          )}
        </MenuPopover>
      )}
    </div>
  );
}

/** List a directory's entries (name + isDir) from the single tree endpoint. */
async function listDir(cwd: string, relDir: string): Promise<DirEntry[]> {
  // Never raises the access-grant dialog: the tree rail is not a preview and
  // declares no provenance (surface-denial-remedy-in-previews, D4).
  return fetchWithoutGrantPrompt(
    `${getApiBase()}/api/file/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(relDir || ".")}`,
  )
    .then((r) => r.json())
    .then((b) => (b.success ? (b.data.entries as DirEntry[]) : []))
    .catch(() => [] as DirEntry[]);
}

/** A directory header row: toggle button + row actions (copy only; no download). */
function DirRow({
  cwd,
  rel,
  name,
  pad,
  open,
  hasChanges,
  onToggle,
}: {
  cwd: string;
  rel: string;
  name: string;
  pad: number;
  open: boolean;
  hasChanges: boolean;
  onToggle: () => void;
}) {
  const menu = useRowMenu();
  return (
    <div
      data-row={rel}
      className="group relative flex items-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      {...rowMenuTriggers(menu)}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs"
        style={{ paddingLeft: pad }}
      >
        <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.5} />
        <Icon path={mdiFolderOutline} size={0.55} />
        <span className="truncate">{name}</span>
        {hasChanges && (
          <span
            data-testid="folder-dot"
            className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400"
            title={i18nT("diff.dirHasChanges", undefined, "Contains changed files")}
          />
        )}
      </button>
      <RowActionsMenu cwd={cwd} rel={rel} isDir menu={menu} />
    </div>
  );
}

function TreeNode({
  cwd,
  relDir,
  depth,
  treeOpenRoots,
  onToggleRoot,
  onOpenFile,
  onOpenDiff,
  activePath,
  diffIndex,
}: {
  cwd: string;
  relDir: string;
  depth: number;
  diffIndex: DiffIndex;
} & Omit<EditorFileTreeProps, "cwd" | "sessionOnly">) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  // Ref on the active row so it can be scrolled into view when it (re)mounts
  // or when the active tab changes (#5).
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    void listDir(cwd, relDir)
      .then((e) => active && setEntries(e))
      .catch(logRejection("EditorFileTree.listDir"));
    return () => {
      active = false;
    };
  }, [cwd, relDir]);

  // Reveal the active row once entries render (or activePath changes).
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries, activePath]);

  if (entries === null) {
    return <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]" style={{ paddingLeft: depth * 12 + 8 }}>{t("common.loading2", undefined, "Loading…")}</div>;
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
              <DirRow
                cwd={cwd}
                rel={rel}
                name={entry.name}
                pad={pad}
                open={open}
                hasChanges={diffIndex.dirs.has(rel)}
                onToggle={() => onToggleRoot(rel)}
              />
              {open && (
                <TreeNode
                  cwd={cwd}
                  relDir={rel}
                  depth={depth + 1}
                  treeOpenRoots={treeOpenRoots}
                  onToggleRoot={onToggleRoot}
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                  activePath={activePath}
                  diffIndex={diffIndex}
                />
              )}
            </div>
          );
        }
        const viewer = fileKind(absOf(cwd, rel)).viewer;
        const isActive = rel === activePath;
        return (
          <FileRow
            key={rel}
            cwd={cwd}
            rel={rel}
            name={entry.name}
            depth={depth}
            isActive={isActive}
            activeRef={isActive ? activeRowRef : undefined}
            file={diffIndex.files.get(rel)}
            onOpenFile={() => onOpenFile(rel, viewer)}
            onOpenDiff={onOpenDiff}
          />
        );
      })}
    </>
  );
}

/**
 * One file row. When `file` is a changed entry it renders a status indicator,
 * `+X −Y` counts, a hover `diff` chip (opens the `diff:` tab), and — for a
 * file with >1 change events — an expander revealing the per-event history.
 */
function FileRow({
  cwd,
  rel,
  name,
  depth,
  isActive,
  activeRef,
  file,
  onOpenFile,
  onOpenDiff,
}: {
  cwd: string;
  rel: string;
  name: string;
  depth: number;
  isActive: boolean;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
  file?: FileDiffEntry;
  onOpenFile: () => void;
  onOpenDiff?: (relPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const menu = useRowMenu();
  const icon = fileIcon(name);
  const pad = depth * 12 + 8;
  const events = file?.changes ?? [];
  const hasHistory = events.length > 1;

  return (
    <>
      <div
        data-row={rel}
        className={[
          "group relative flex items-center hover:bg-[var(--bg-hover)]",
          isActive ? "bg-[var(--bg-selected)]" : "",
        ].join(" ")}
        {...rowMenuTriggers(menu)}
      >
        {hasHistory && (
          <button
            type="button"
            data-testid="event-expander"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 px-0.5 text-[10px] text-[var(--text-tertiary)]"
            style={{ marginLeft: pad }}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        <button
          type="button"
          ref={activeRef}
          onClick={onOpenFile}
          className={[
            "flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs",
            isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          ].join(" ")}
          style={{ paddingLeft: hasHistory ? 4 : pad + 10 }}
        >
          <Icon path={icon.iconPath} size={0.55} className={icon.colorClass} />
          {file && statusIndicator(file)}
          <span className="truncate">{name}</span>
          {file && (file.additions !== undefined || file.deletions !== undefined) && (
            <span className="ml-1 text-[10px] shrink-0">
              <CountBadges additions={file.additions ?? 0} deletions={file.deletions ?? 0} />
            </span>
          )}
        </button>
        {file && onOpenDiff && (
          <button
            type="button"
            data-testid="open-diff-chip"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDiff(rel);
            }}
            className="mr-1 shrink-0 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)] opacity-0 hover:text-[var(--text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
            title={i18nT("diff.viewDiff", undefined, "View diff")}
          >
            {i18nT("diff.diff", undefined, "diff")}
          </button>
        )}
        <RowActionsMenu cwd={cwd} rel={rel} isDir={false} menu={menu} />
      </div>
      {hasHistory &&
        expanded &&
        events.map((c, i) => (
          <div
            key={i}
            data-testid="change-event-row"
            className="flex items-center gap-2 py-0.5 text-[11px] text-[var(--text-tertiary)]"
            style={{ paddingLeft: pad + 28 }}
          >
            <span>{c.type === "edit" ? "✏️" : "📝"}</span>
            <span className="shrink-0">{relTime(c.timestamp)}</span>
            {c.message && (
              <span className="truncate text-[var(--text-secondary)]" title={c.message}>
                {c.message.length > 50 ? `${c.message.slice(0, 50)}…` : c.message}
              </span>
            )}
          </div>
        ))}
    </>
  );
}

/** Muted, collapsed group of working-tree changes this session did not make. */
function OtherChangesGroup({
  otherChanges,
  onOpenDiff,
}: {
  otherChanges: FileDiffEntry[];
  onOpenDiff?: (relPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (otherChanges.length === 0) return null;
  return (
    <div data-testid="other-changes-group" className="mt-1 border-t border-[var(--border-primary)] pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs italic text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span className="truncate">
          {otherChanges.length} {i18nT("diff.otherWorkingTreeChanges", undefined, "other working-tree changes")}
        </span>
      </button>
      {expanded &&
        otherChanges.map((f) => (
          <button
            type="button"
            key={f.path}
            className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-0.5 text-left text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
            style={{ paddingLeft: 24 }}
            onClick={() => onOpenDiff?.(f.path)}
          >
            <span className="truncate">{f.path}</span>
          </button>
        ))}
    </div>
  );
}

export function EditorFileTree(props: EditorFileTreeProps) {
  const diff = useOptionalSessionDiff();
  const diffIndex = buildDiffIndex(diff?.data?.files ?? []);
  const otherChanges = diff?.data?.otherChanges ?? [];
  const download = useDownload();
  const startRowDownload = (rel: string) => void download.start({ cwd: props.cwd, path: rel }, false);
  return (
    <RowDownloadContext.Provider value={startRowDownload}>
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
        onOpenDiff={props.onOpenDiff}
        activePath={props.activePath}
        diffIndex={diffIndex}
      />
      {!props.sessionOnly && (
        <OtherChangesGroup otherChanges={otherChanges} onOpenDiff={props.onOpenDiff} />
      )}
      {download.tray}
    </div>
    </RowDownloadContext.Provider>
  );
}
