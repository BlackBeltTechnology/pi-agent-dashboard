/**
 * Search tabs popover (`⌄` in the pane bar): a combobox over the OPEN tabs with
 * live `matchTabs` filtering, highlights, an unsaved dot, Delete to close the
 * selected tab, a per-row ✕ and bulk footer actions routed through the pane's
 * bulk-close runner. Enter on no match falls through to rail Search (Filenames,
 * prefilled) when file search exists, else shows "No open tab matches".
 *
 * See change: scope-anchor-editor-pane-controls (D8).
 */
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import type { OpenFile } from "../../lib/layout/editor-pane-state.js";
import { type HighlightRange, matchTabs } from "../../lib/layout/match-tabs.js";
import { fileIcon } from "../../lib/preview/file-icon.js";
import { type TabTextDeps, tabHaystack } from "./tab-labels.js";

export interface TabSearchPopoverProps {
  anchorEl: HTMLElement;
  openFiles: readonly OpenFile[];
  activeIndex: number;
  textDeps: TabTextDeps;
  pluginLabel?: (path: string) => ReactNode;
  /** Paths of tabs with CONFIRMED unsaved edits (`dirty === true`). */
  unsavedPaths: ReadonlySet<string>;
  /** Rail Search is available (session panes). */
  hasFileSearch: boolean;
  onActivate: (path: string) => void;
  /** Single close path (same as the tab ×). */
  onCloseTab: (path: string) => void;
  /** Bulk close through the pane runner; the pane closes this popover first. */
  onBulkClose: (paths: string[]) => void;
  onFallThrough: (query: string) => void;
  onClose: () => void;
}

function Highlighted({ text, ranges }: { text: string; ranges: readonly HighlightRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <mark key={`${s}:${i}`} className="rounded-sm bg-[var(--bg-selected)] text-inherit">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export function TabSearchPopover(p: TabSearchPopoverProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const queryEmpty = query.trim() === "";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows = useMemo(() => {
    const hay = p.openFiles.map((file) => ({ file, ...tabHaystack(file, p.textDeps) }));
    return matchTabs(hay, query);
  }, [p.openFiles, p.textDeps, query]);
  const sel = rows.length === 0 ? -1 : Math.min(selected, rows.length - 1);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const close = () => {
    p.onClose();
    p.anchorEl.focus();
  };
  const activate = (path: string) => {
    p.onClose();
    p.onActivate(path);
  };

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    if (delta === 1) setSelected(sel < 0 ? 0 : (sel + 1) % rows.length);
    else setSelected(sel <= 0 ? rows.length - 1 : sel - 1);
  };
  const onEnter = () => {
    if (sel >= 0) activate(rows[sel].tab.file.path);
    else if (!queryEmpty && p.hasFileSearch) {
      p.onClose();
      p.onFallThrough(query.trim());
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    // Delete/Backspace closes the selected tab only with an empty field, else it edits the text.
    const closesSelected = (e.key === "Delete" || e.key === "Backspace") && query === "" && sel >= 0;
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key) && !closesSelected) return;
    e.preventDefault();
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter") onEnter();
    else if (e.key === "Escape") close();
    else p.onCloseTab(rows[sel].tab.file.path);
  };

  const activePath = p.openFiles[p.activeIndex]?.path;
  const bulk = queryEmpty
    ? [
        {
          key: "all-but-active",
          label: t("editor.closeAllButActive", undefined, "Close all but the active tab"),
          paths: p.openFiles.filter((f) => f.path !== activePath).map((f) => f.path),
        },
        { key: "all", label: t("editor.closeAllTabs", undefined, "Close all tabs"), paths: p.openFiles.map((f) => f.path) },
      ]
    : rows.length > 0
      ? [
          {
            key: "matching",
            label:
              rows.length === 1
                ? t("editor.closeMatchingTab", undefined, "Close 1 matching tab")
                : t("editor.closeMatchingTabs", { count: rows.length }, "Close {count} matching tabs"),
            paths: rows.map((r) => r.tab.file.path),
          },
        ]
      : [];

  return (
    <Popover anchorEl={p.anchorEl} onDismiss={p.onClose}>
      <div
        data-testid="tab-search-popover"
        className="w-[320px] max-w-[90vw] overflow-hidden rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg"
      >
        <input
          ref={inputRef}
          data-testid="tab-search-input"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={sel >= 0 ? optionId(sel) : undefined}
          aria-label={t("editor.searchTabs", undefined, "Search tabs")}
          placeholder={t("editor.searchTabs", undefined, "Search tabs")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm outline-none"
        />
        <ul id={listId} role="listbox" aria-label={t("editor.openFiles", undefined, "Open files")} className="max-h-64 overflow-auto py-1">
          {rows.map((r, i) => {
            const file = r.tab.file;
            return (
              <li key={file.path} role="presentation" className="flex items-center">
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === sel}
                  data-testid="tab-search-option"
                  data-tab-path={file.path}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => activate(file.path)}
                  className={[
                    "flex min-h-7 min-w-0 flex-1 cursor-pointer items-baseline gap-2 px-3 py-1 text-xs",
                    i === sel ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  {file.viewer !== "terminal" && file.viewer !== "plugin" && (
                    <Icon path={fileIcon(file.path).iconPath} size={0.5} className={`self-center ${fileIcon(file.path).colorClass}`} />
                  )}
                  <span className="truncate font-medium">
                    {file.viewer === "plugin" ? (
                      (p.pluginLabel?.(file.path) ?? file.path)
                    ) : (
                      <Highlighted text={r.tab.label} ranges={r.labelRanges} />
                    )}
                  </span>
                  {r.tab.location && (
                    <span className="truncate text-[var(--text-tertiary)]">
                      <Highlighted text={r.tab.location} ranges={r.locationRanges} />
                    </span>
                  )}
                  {p.unsavedPaths.has(file.path) && (
                    <span
                      data-testid="tab-search-unsaved"
                      role="img"
                      aria-label={t("editor.unsavedChanges", undefined, "Unsaved changes")}
                      className="inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full bg-[var(--accent-blue)]"
                    />
                  )}
                </div>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="tab-search-row-close"
                  aria-label={t("editor.closeFile", { name: r.tab.label || file.path }, "Close {name}")}
                  onClick={() => p.onCloseTab(file.path)}
                  className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Icon path={mdiClose} size={0.5} />
                </button>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 && !queryEmpty && !p.hasFileSearch && (
          <p data-testid="tab-search-empty" className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
            {t("editor.noTabMatches", undefined, "No open tab matches")}
          </p>
        )}
        {rows.length === 0 && !queryEmpty && p.hasFileSearch && (
          <p data-testid="tab-search-empty" className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
            {t("editor.noTabMatchesSearchFiles", undefined, "No open tab matches. Press Enter to search files")}
          </p>
        )}
        {bulk.length > 0 && (
          <div className="border-t border-[var(--border-primary)] py-1">
            {bulk.map((b) => (
              <button
                key={b.key}
                type="button"
                data-testid={`tab-search-bulk-${b.key}`}
                disabled={b.paths.length === 0}
                onClick={() => p.onBulkClose(b.paths)}
                className="flex min-h-7 w-full items-center px-3 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}
