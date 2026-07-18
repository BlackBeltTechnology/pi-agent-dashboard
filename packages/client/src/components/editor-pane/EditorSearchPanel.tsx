/**
 * Dual-mode editor search panel: **Filenames** (bridge walk via `list_files`)
 * and **Contents** (grep via `GET /api/grep`). Type-ahead with a substring or
 * regexp matcher, a min-length guard + debounce, and keyboard navigation
 * (`↑↓` move, `↵` open, `Esc` close). Opening a result funnels through
 * `onOpen` (the pane's `openInSplit`); content matches carry their line so the
 * viewer scrolls to it.
 *
 * Pure/injected: filename + content searches are provided by the caller so the
 * panel is testable without a WebSocket or the network.
 *
 * See change: split-editor-workspace.
 */

import type { FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClose, mdiMagnify, mdiRegex } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GrepMatch } from "../../lib/api/grep-api.js";
import { useI18n } from "../../lib/i18n/i18n.js";

interface EditorSearchPanelProps {
  cwd: string;
  /** Latest bridge walk result (shared with the composer's `@` autocomplete). */
  fileResults: { query: string; files: FileEntry[] } | null;
  /** Fire a bridge filename walk (Filenames mode). */
  onFilenameSearch: (query: string, regex: boolean) => void;
  /** Run a content grep (Contents mode). */
  onContentSearch: (query: string, regex: boolean) => Promise<GrepMatch[]>;
  /** Open a result — auto-splits if needed; `line` scrolls a content match. */
  onOpen: (relPath: string, line?: number) => void;
  onClose: () => void;
  minLen?: number;
}

type Mode = "file" | "content";
const DEBOUNCE_MS = 200;

export function EditorSearchPanel({
  cwd,
  fileResults,
  onFilenameSearch,
  onContentSearch,
  onOpen,
  onClose,
  minLen = 3,
}: EditorSearchPanelProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("file");
  const [regex, setRegex] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [contentResults, setContentResults] = useState<GrepMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the query.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const belowMin = debounced.length > 0 && debounced.length < minLen;
  const canSearch = debounced.length >= minLen;

  // Fire the active mode's search when the debounced query is long enough.
  useEffect(() => {
    if (!canSearch) {
      setContentResults([]);
      return;
    }
    setActiveIndex(0); // reset selection whenever a new search fires
    if (mode === "file") {
      onFilenameSearch(debounced, regex);
      return;
    }
    let cancelled = false;
    void onContentSearch(debounced, regex).then((r) => {
      if (!cancelled) setContentResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, mode, regex, canSearch, onFilenameSearch, onContentSearch]);

  const fileItems =
    mode === "file" && fileResults && fileResults.query === debounced ? fileResults.files : [];

  const items = useMemo(() => {
    if (!canSearch) return [];
    return mode === "file"
      ? fileItems.map((f) => ({ kind: "file" as const, path: f.path }))
      : contentResults.map((m) => ({ kind: "content" as const, ...m }));
  }, [mode, fileItems, contentResults, canSearch]);

  const openItem = (item: (typeof items)[number] | undefined) => {
    if (!item) return;
    onOpen(item.path, item.kind === "content" ? item.line : undefined);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openItem(items[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const modeBtn = (m: Mode, label: string, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => setMode(m)}
      className={`px-2 py-0.5 text-xs rounded ${
        mode === m
          ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2" data-testid="editor-search-panel">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded bg-[var(--bg-tertiary)] p-0.5">
          {modeBtn("file", t("editor.filenames", undefined, "Filenames"), "mode-file")}
          {modeBtn("content", t("editor.contents", undefined, "Contents"), "mode-content")}
        </div>
        <div className="relative flex flex-1 items-center">
          <Icon path={mdiMagnify} size={0.6} className="absolute left-2 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            data-testid="editor-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("editor.searchPlaceholder", { min: minLen }, "Regexp or type-ahead… (min {min} chars)")}
            className="w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] py-1 pl-7 pr-2 text-sm outline-none focus:border-blue-500/50"
          />
        </div>
        <button
          type="button"
          data-testid="regex-toggle"
          aria-pressed={regex}
          onClick={() => setRegex((r) => !r)}
          className={`rounded p-1 ${regex ? "text-blue-400 bg-blue-500/10" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          title={t("editor.regularExpression", undefined, "Regular expression")}
        >
          <Icon path={mdiRegex} size={0.7} />
        </button>
        <button
          type="button"
          data-testid="editor-search-close"
          onClick={onClose}
          className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          title={t("editor.closeEsc", undefined, "Close (Esc)")}
        >
          <Icon path={mdiClose} size={0.7} />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between px-0.5 text-[11px] text-[var(--text-tertiary)]">
        <span>
          {belowMin
            ? t("editor.typeMinChars", { min: minLen }, "Type ≥ {min} chars")
            : canSearch
              ? items.length === 1
                ? t("editor.resultCountOne", { count: items.length }, "{count} result")
                : t("editor.resultCountMany", { count: items.length }, "{count} results")
              : ""}
        </span>
        <span>
          <kbd>↑↓</kbd> {t("editor.navigate", undefined, "navigate")} · <kbd>↵</kbd> {t("editor.open", undefined, "open")} · <kbd>Esc</kbd> {t("editor.close", undefined, "close")}
        </span>
      </div>

      {items.length > 0 && (
        <ul className="mt-1 max-h-64 overflow-auto text-sm" data-testid="editor-search-results">
          {items.map((item, i) => (
            <li key={`${item.path}:${item.kind === "content" ? item.line : "f"}:${i}`}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => openItem(item)}
                className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left ${
                  i === activeIndex ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="truncate font-mono text-xs">{item.path}</span>
                {item.kind === "content" && (
                  <>
                    <span className="shrink-0 text-[var(--text-tertiary)]">:{item.line}</span>
                    <span className="truncate text-[var(--text-secondary)]">{item.snippet}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
