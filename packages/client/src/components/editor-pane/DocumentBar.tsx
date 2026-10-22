/**
 * Document bar — the second pane-chrome row, about the ACTIVE tab (design D2):
 * breadcrumb, view-mode switcher, Reload, system actions and a `⋯` menu for a
 * file; the url and its browser action for a url tab; a title line for
 * diff / live / terminal / plugin tabs; hidden with no tab.
 *
 * Below 640 px (`narrow`, design D3) Open/Reveal move into `⋯` (rendered once,
 * keeping their test ids) and the breadcrumb collapses its ancestors to `…`.
 *
 * See change: scope-anchor-editor-pane-controls (D2, D3, D10, D11).
 */
import { mdiCheck, mdiChevronRight, mdiDotsHorizontal, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import type { OpenFile } from "../../lib/layout/editor-pane-state.js";
import { copyText } from "../../lib/util/clipboard.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";
import type { FileHandlerClaim } from "./file-handler/file-handler-claims.js";
import { FileModeSwitcher } from "./file-handler/FileModeSwitcher.js";
import { MenuItem, MenuPopover } from "./MenuPopover.js";
import { TabActions, type TabActionTarget } from "./TabActions.js";
import { basename, tabLabelText } from "./tab-labels.js";
import { isPseudoTabViewer } from "./viewer-kinds.js";

export interface DocumentBarProps {
  tab: OpenFile | null;
  cwd: string;
  narrow: boolean;
  systemOpen: boolean;
  platform?: string;
  /** Mode-switcher inputs (empty `claims` → no switcher). */
  claims: readonly FileHandlerClaim[];
  selectedMode: string | undefined;
  outsideCwd: boolean;
  onSelectMode: (mode: string | undefined) => void;
  terminalTitle?: (id: string) => string | undefined;
  pluginLabel?: (path: string) => ReactNode;
  onReload: () => void;
  /** Reveal the file's row in the tree rail (expand-only). */
  onShowInTree: () => void;
  /** Expand + reveal a breadcrumb folder (`relPath` of the folder). */
  onOpenFolder: (relPath: string) => void;
  onOverlayChange?: (open: boolean) => void;
}

const BTN =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const SEG = "inline-flex min-h-6 items-center rounded px-1 text-xs";

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

function Breadcrumb({
  path,
  cwd,
  outsideCwd,
  narrow,
  leafRef,
  onOpenFolder,
  onLeaf,
}: {
  path: string;
  cwd: string;
  outsideCwd: boolean;
  narrow: boolean;
  leafRef: React.Ref<HTMLButtonElement>;
  onOpenFolder: (relPath: string) => void;
  onLeaf: () => void;
}) {
  const { t } = useI18n();
  const parts = path.split(/[/\\]/).filter(Boolean);
  const leaf = parts[parts.length - 1] ?? path;
  const folders = parts.slice(0, -1);
  const sep = <Icon path={mdiChevronRight} size={0.5} className="shrink-0 text-[var(--text-tertiary)]" />;
  const leafBtn = (
    <button
      ref={leafRef}
      type="button"
      onClick={onLeaf}
      aria-haspopup="menu"
      title={t("editor.moreActions", undefined, "More actions")}
      className={`${SEG} truncate font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`}
    >
      {leaf}
    </button>
  );
  if (outsideCwd) {
    // Absolute path, inert segments: no tree row exists for it.
    return (
      <nav aria-label={t("editor.breadcrumb", undefined, "Path")} data-testid="doc-breadcrumb" className="flex min-w-0 items-center">
        <span className={`${SEG} truncate text-[var(--text-tertiary)]`} title={absOf(cwd, path)}>
          {path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path.slice(0, path.length - leaf.length) : ""}
        </span>
        {leafBtn}
      </nav>
    );
  }
  const shown = narrow ? [] : folders;
  return (
    <nav aria-label={t("editor.breadcrumb", undefined, "Path")} data-testid="doc-breadcrumb" className="flex min-w-0 items-center">
      {narrow && folders.length > 0 && (
        <>
          <span className={`${SEG} text-[var(--text-tertiary)]`} title={folders.join("/")}>
            …
          </span>
          {sep}
        </>
      )}
      {shown.map((seg, i) => (
        <span key={folders.slice(0, i + 1).join("/")} className="flex min-w-0 items-center">
          <button
            type="button"
            onClick={() => onOpenFolder(folders.slice(0, i + 1).join("/"))}
            className={`${SEG} truncate text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`}
          >
            {seg}
          </button>
          {sep}
        </span>
      ))}
      {leafBtn}
    </nav>
  );
}

function MoreMenu({
  anchorEl,
  target,
  tab,
  cwd,
  outsideCwd,
  narrow,
  systemOpen,
  platform,
  onShowInTree,
  onClose,
}: {
  anchorEl: HTMLElement;
  target: Extract<TabActionTarget, { kind: "file" }>;
  tab: OpenFile;
  cwd: string;
  outsideCwd: boolean;
  narrow: boolean;
  systemOpen: boolean;
  platform?: string;
  onShowInTree: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = (key: string, payload: string) => {
    // copyText never rejects: an unavailable clipboard falls back / fails silently.
    void copyText(payload);
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onClose, 1500);
  };
  const tick = (key: string) => (copied === key ? <Icon path={mdiCheck} size={0.55} className="text-green-500" /> : null);
  const rel = tab.path;
  const full = outsideCwd ? rel : absOf(cwd, rel);
  return (
    <MenuPopover anchorEl={anchorEl} label={t("editor.moreActions", undefined, "More actions")} testId="doc-more-menu-panel" onClose={onClose}>
      {narrow && <TabActions target={target} systemOpen={systemOpen} platform={platform} variant="menu" onActivate={onClose} />}
      {!outsideCwd && (
        <MenuItem
          testId="doc-show-in-tree"
          label={t("editor.showInFileTree", undefined, "Show in file tree")}
          onSelect={() => {
            onClose();
            onShowInTree();
          }}
        />
      )}
      <MenuItem testId="doc-copy-full" label={t("editor.copyFullPath", undefined, "Copy full path")} trailing={tick("full")} onSelect={() => copy("full", full)} />
      {!outsideCwd && (
        <MenuItem testId="doc-copy-rel" label={t("editor.copyRelativePath", undefined, "Copy relative path")} trailing={tick("rel")} onSelect={() => copy("rel", rel)} />
      )}
      <MenuItem testId="doc-copy-name" label={t("editor.copyFileName", undefined, "Copy file name")} trailing={tick("name")} onSelect={() => copy("name", basename(rel))} />
    </MenuPopover>
  );
}

export function DocumentBar(props: DocumentBarProps) {
  const { t } = useI18n();
  const { tab, cwd, narrow, systemOpen, platform, onOverlayChange } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const leafRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => onOverlayChange?.(moreOpen), [moreOpen, onOverlayChange]);
  // A different tab closes the menu: its items describe the previous tab.
  const tabPath = tab?.path;
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing on tab change is the intent
  useEffect(() => setMoreOpen(false), [tabPath]);
  if (!tab) return null;

  const frame = "flex min-h-8 shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-2";
  const isFile = !isPseudoTabViewer(tab.viewer);

  if (tab.viewer === "url") {
    const url = tab.path.replace(/^url:/, "");
    return (
      <div data-testid="doc-bar" className={frame}>
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-[var(--text-secondary)]" title={url}>
          {url}
        </span>
        <TabActions target={{ kind: "url", url }} systemOpen={systemOpen} platform={platform} />
      </div>
    );
  }

  if (!isFile) {
    const text = tabLabelText(tab, {
      terminalTitle: props.terminalTitle,
      terminalFallback: t("terminal.terminal", undefined, "terminal"),
    });
    return (
      <div data-testid="doc-bar" className={frame}>
        <span data-testid="doc-title" className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-[var(--text-primary)]">
          {tab.viewer === "plugin" ? (
            <ErrorBoundary fallback={<span>{tab.path}</span>}>{props.pluginLabel?.(tab.path) ?? tab.path}</ErrorBoundary>
          ) : (
            text
          )}
        </span>
      </div>
    );
  }

  const target: Extract<TabActionTarget, { kind: "file" }> = { kind: "file", cwd, path: tab.path };
  const openMore = (el: HTMLElement | null) => {
    setAnchor(el);
    setMoreOpen(true);
  };
  return (
    <div data-testid="doc-bar" className={frame}>
      <div className="min-w-0 flex-1">
        <Breadcrumb
          path={tab.path}
          cwd={cwd}
          outsideCwd={props.outsideCwd}
          narrow={narrow}
          leafRef={leafRef}
          onOpenFolder={props.onOpenFolder}
          onLeaf={() => openMore(leafRef.current)}
        />
      </div>
      {props.claims.length > 0 && (
        <FileModeSwitcher claims={props.claims} selected={props.selectedMode} outsideCwd={props.outsideCwd} onSelect={props.onSelectMode} />
      )}
      <button
        type="button"
        data-testid="tab-reload"
        onClick={props.onReload}
        className={BTN}
        aria-label={t("editor.reloadFile", undefined, "Reload file")}
        title={t("editor.reloadFile", undefined, "Reload file")}
      >
        <Icon path={mdiRefresh} size={0.7} />
      </button>
      {!narrow && <TabActions target={target} systemOpen={systemOpen} platform={platform} />}
      <button
        ref={moreRef}
        type="button"
        data-testid="doc-more-menu"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={() => openMore(moreRef.current)}
        className={BTN}
        aria-label={t("editor.moreActions", undefined, "More actions")}
        title={t("editor.moreActions", undefined, "More actions")}
      >
        <Icon path={mdiDotsHorizontal} size={0.7} />
      </button>
      {moreOpen && anchor && (
        <MoreMenu
          anchorEl={anchor}
          target={target}
          tab={tab}
          cwd={cwd}
          outsideCwd={props.outsideCwd}
          narrow={narrow}
          systemOpen={systemOpen}
          platform={platform}
          onShowInTree={props.onShowInTree}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </div>
  );
}
