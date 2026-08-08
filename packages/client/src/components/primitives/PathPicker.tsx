import { parsePathInput, withTrailingSep } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import type { BrowseEntry, BrowseResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiArrowUp,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiChevronRight,
  mdiFolder,
  mdiFolderPlusOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { browseDirectory, classifyPaths, createDirectory } from "../../lib/api/browse-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { inferPlatform, pathKey } from "../../lib/session/session-grouping.js";
import { logRejection } from "../../lib/report-error.js";

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  rows?: number;
  /**
   * Affordance for the "Settings → Servers" link shown when a browse call is
   * refused by the network guard (403 `network_not_allowed`). Optional — the
   * remedy hint still renders without it.
   * See change: distinguish-offline-from-network-denied.
   */
  onOpenServers?: () => void;
  /**
   * Opt-in MULTI-SELECT mode. Absent (the default) keeps every existing caller
   * single-select. Present, the picker becomes a file explorer: the row body
   * still navigates (as it always has) and a per-row checkbox accumulates the
   * caller's selection set — the caller commits the whole basket, so the picker
   * never calls `onSelect` from a row.
   * See change: redesign-folder-workspace-add-flow.
   */
  selection?: {
    /** Absolute paths currently in the caller's basket. */
    selected: Set<string>;
    /** Toggle membership of `path` in the basket. */
    onToggle: (path: string) => void;
  };
  /**
   * Live-session counts keyed by `pathKey(cwd)` (NOT raw path strings — the key
   * collapses trailing-separator / case drift). A row whose path resolves to a
   * key in this map renders a session-count badge, surfacing loose cwds the
   * user already works in without typing a path.
   * See change: redesign-folder-workspace-add-flow.
   */
  sessionCounts?: Map<string, number>;
}

/**
 * Delegates to the shared `parsePathInput` primitive. Platform is
 * inferred from the input so the picker works correctly on both Windows
 * (backslash / drive letter) and POSIX.
 */
function parseInput(value: string): { parent: string; partial: string } {
  const platform = inferPlatform([value]);
  return parsePathInput(value, platform);
}

const DEBOUNCE_MS = 150;

type DisplayItem =
  | { type: "parent" }
  | { type: "entry"; entry: BrowseEntry }
  | { type: "create-here"; name: string };

export function PathPicker({ initialPath, onSelect, onCancel, rows = 8, onOpenServers, selection, sessionCounts }: Props) {
  const multiSelect = selection !== undefined;
  const [inputValue, setInputValue] = useState(initialPath ?? "");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when a browse call is refused by the network guard (403
  // network_not_allowed). Rendered as an actionable remedy surface,
  // distinct from the bare `error` string. See change:
  // distinguish-offline-from-network-denied.
  const [denial, setDenial] = useState<{ hint?: string } | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [invalidFlash, setInvalidFlash] = useState(false);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The currently fetched directory + query key
  const fetchedDirRef = useRef<string | null>(null);
  const fetchedQRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFetchRef = useRef<(() => Promise<void>) | null>(null);
  /**
   * Set once the user edits the input. The mount-time default-directory fetch
   * resolves asynchronously and used to `setInputValue(result.current)`
   * unconditionally, wiping anything typed while it was in flight (a fast
   * typist — or a programmatic fill — lost the whole path and silently ended up
   * browsing HOME). Adopt the server default ONLY while the field is pristine.
   */
  const userEditedRef = useRef(false);

  /**
   * Fetch directory contents. If `q` is non-empty, filters server-side.
   * Aborts any in-flight request. If `force` is true, bypasses the
   * already-fetched dedup.
   */
  const fetchDir = useCallback(
    async (dir: string | undefined, q: string, force = false) => {
      // Dedup only once we've successfully fetched something
      if (!force && fetchedDirRef.current !== null && dir !== undefined) {
        if (dir === fetchedDirRef.current && q === fetchedQRef.current) return;
      }

      // Abort previous in-flight
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);
      setDenial(null);
      try {
        const result = await browseDirectory(dir, { q, signal: ctrl.signal });
        // Ignore stale response if a newer request superseded us
        if (abortRef.current !== ctrl) return;
        fetchedDirRef.current = result.current;
        fetchedQRef.current = q;
        setEntries(result.entries);
        setParentPath(result.parent);
        setHighlightIndex(-1);

        // Phase 2: lazily classify the rendered entries via the bulk
        // `/api/browse/flags` endpoint, then merge the flags into the
        // entries already on screen. Fire-and-forget; aborts share the
        // phase-1 controller so a rapid re-invocation cancels both. Phase-2
        // errors are swallowed silently — the picker keeps the flag-less
        // entries and just doesn't render badges.
        // See change: split-browse-flags.
        if (result.entries.length > 0) {
          const paths = result.entries.map((e) => e.path);
          classifyPaths(paths, { signal: ctrl.signal })
            .then((flagMap) => {
              if (abortRef.current !== ctrl) return;
              setEntries((prev) =>
                prev.map((e) => {
                  const flags = flagMap[e.path];
                  return flags ? { ...e, isGit: flags.isGit, isPi: flags.isPi } : e;
                }),
              );
            })
            .catch(() => { /* swallow — badges stay absent */ });
        }

        return result;
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string; code?: string; hint?: string };
        if (e?.name === "AbortError") return;
        // A network-guard denial is a distinct, actionable state — render the
        // remedy hint, not a bare error string.
        if (e?.code === "network_not_allowed") {
          setDenial({ hint: e.hint });
          setEntries([]);
          return null;
        }
        setError(e?.message ?? "Failed to browse");
        setEntries([]);
        return null;
      } finally {
        if (abortRef.current === ctrl) setLoading(false);
      }
    },
    [],
  );

  // Schedule a debounced fetch; stores a flush-fn so Enter can force it now.
  const scheduleFetch = useCallback(
    (dir: string | undefined, q: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      const run = () => fetchDir(dir, q);
      pendingFetchRef.current = async () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        await run();
        pendingFetchRef.current = null;
      };
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        pendingFetchRef.current = null;
        void run();
      }, DEBOUNCE_MS);
    },
    [fetchDir],
  );

  // Initial fetch
  useEffect(() => {
    if (initialPath) {
      const { parent, partial } = parseInput(initialPath);
      void fetchDir(parent, partial);
    } else {
      // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
      void fetchDir(undefined, "")
        .then((result) => {
        // Never clobber input the user has already typed (see userEditedRef).
        if (result && !userEditedRef.current) {
          // Append OS-native separator using the platform the server
          // reports (falls back to inference if absent for backward-
          // compat with older servers).
          const platform = result.platform ?? inferPlatform([result.current]);
          setInputValue(withTrailingSep(result.current, platform));
        }
        })
        .catch(logRejection("PathPicker.fetchDir"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Parse current input
  const { parent: currentParent, partial } = parseInput(inputValue);

  // Use server-filtered entries directly (no client-side filter).
  const filtered = entries;

  // Exact-match detection (case-insensitive) against returned entries
  const exactMatch = partial
    ? entries.find((e) => e.name.toLowerCase() === partial.toLowerCase())
    : undefined;

  // Create-here row is available only when the parsed parent equals the
  // fetched directory (prevents creating inside a stale last-successful dir
  // after a typo mid-path).
  const createHereAvailable =
    partial.length > 0 &&
    !exactMatch &&
    fetchedDirRef.current !== null &&
    currentParent === fetchedDirRef.current;

  const showDotDot = parentPath !== null;
  const displayItems: DisplayItem[] = [];
  if (showDotDot) displayItems.push({ type: "parent" });
  for (const entry of filtered) {
    displayItems.push({ type: "entry", entry });
  }
  if (createHereAvailable) {
    displayItems.push({ type: "create-here", name: partial });
  }

  // Input change → debounced server fetch with (parent, partial) as q.
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    userEditedRef.current = true;
    setInputValue(value);
    setHighlightIndex(-1);
    const { parent, partial: newPartial } = parseInput(value);
    scheduleFetch(parent, newPartial);
  };

  const descendInto = (dirPath: string) => {
    // Counts as a user edit: this writes `inputValue`, so a late-resolving
    // mount-time default fetch must not overwrite it either.
    userEditedRef.current = true;
    // Use OS-native separator so a Windows-resolved path stays in
    // backslash form (previously `dirPath + "/"` produced mixed
    // separators like `C:\Users\me/`).
    const platform = inferPlatform([dirPath]);
    const newValue = withTrailingSep(dirPath, platform);
    setInputValue(newValue);
    setHighlightIndex(-1);
    // force refetch for the new directory (no query)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingFetchRef.current = null;
    void fetchDir(dirPath, "", true);
  };

  const triggerInvalid = () => {
    setInvalidFlash(true);
    setTimeout(() => setInvalidFlash(false), 300);
  };

  const createFolder = useCallback(
    async (parent: string, name: string) => {
      try {
        const result = await createDirectory(parent, name);
        descendInto(result.path);
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e?.message ?? "mkdir failed");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleItemClick = (item: DisplayItem) => {
    if (item.type === "parent" && parentPath) {
      descendInto(parentPath);
    } else if (item.type === "entry") {
      descendInto(item.entry.path);
    } else if (item.type === "create-here") {
      if (!fetchedDirRef.current) return;
      void createFolder(fetchedDirRef.current, item.name);
    }
    inputRef.current?.focus();
  };

  /**
   * Evaluate the Enter/Select state machine. Returns true if handled,
   * false if the caller should flash-invalid.
   * Note: if a debounced fetch is pending this flushes it synchronously first.
   */
  const tryConfirm = useCallback(async (): Promise<boolean> => {
    // Flush any pending debounced query so rules evaluate against fresh data
    if (pendingFetchRef.current) {
      await pendingFetchRef.current();
    }

    const { parent: p, partial: pt } = parseInput(inputValue);
    const ptTrim = pt.trim();

    // Rule 1: exact match against a visible entry (case-insensitive)
    if (ptTrim) {
      const hit = entries.find((e) => e.name.toLowerCase() === ptTrim.toLowerCase());
      if (hit) {
        onSelect(hit.path);
        return true;
      }
    }

    // Rule 2: input ends with the OS-native separator (`/` on POSIX, `\`
    // on Windows, plus UNC paths terminated by `\`) and parsed parent
    // equals the fetched dir. The picker itself writes a trailing
    // separator after every navigation step via `withTrailingSep` —
    // accepting only `/` here made every Windows confirmation
    // (Enter or Select button) fall through to `triggerInvalid`.
    // See change: fix-pathpicker-windows-trailing-sep.
    if (
      (inputValue.endsWith("/") || inputValue.endsWith("\\")) &&
      fetchedDirRef.current === p
    ) {
      onSelect(inputValue);
      return true;
    }

    // Rule 3: exactly one candidate → complete (don't close)
    if (entries.length === 1 && ptTrim) {
      descendInto(entries[0].path);
      return true;
    }

    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, entries, onSelect]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, displayItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Tab") {
      e.preventDefault();
      // If highlight is on an item, act on it
      if (highlightIndex >= 0 && highlightIndex < displayItems.length) {
        handleItemClick(displayItems[highlightIndex]);
      } else if (filtered.length === 1) {
        descendInto(filtered[0].path);
      }
    } else if (e.key === " " && multiSelect) {
      // Multi-select only: Space TOGGLES the highlighted row's selection while
      // Enter still ACTIVATES (descends). In single-select mode Space stays a
      // literal space character for the path input.
      // See change: redesign-folder-workspace-add-flow.
      if (highlightIndex >= 0 && highlightIndex < displayItems.length) {
        const item = displayItems[highlightIndex];
        if (item.type === "entry") {
          e.preventDefault();
          selection?.onToggle(item.entry.path);
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If the highlighted item is the create-here row, trigger it
      if (highlightIndex >= 0 && highlightIndex < displayItems.length) {
        const item = displayItems[highlightIndex];
        if (item.type === "create-here") {
          handleItemClick(item);
          return;
        }
        // Multi-select: Enter on a highlighted directory descends into it. The
        // basket — not the input — is the answer, so tryConfirm never runs.
        if (multiSelect && item.type === "entry") {
          handleItemClick(item);
          return;
        }
      }
      // Multi-select has no single-path answer to confirm.
      if (multiSelect) return;
      void (async () => {
        const handled = await tryConfirm();
        if (!handled) triggerInvalid();
      })();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[role='option']");
    items[highlightIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [highlightIndex]);

  // Focus the new-folder inline input when opened
  useEffect(() => {
    if (newFolderMode) newFolderInputRef.current?.focus();
  }, [newFolderMode]);

  const handleNewFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = newFolderName.trim();
      if (!name) {
        triggerInvalid();
        return;
      }
      if (!fetchedDirRef.current) return;
      setNewFolderMode(false);
      setNewFolderName("");
      void createFolder(fetchedDirRef.current, name);
      inputRef.current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setNewFolderMode(false);
      setNewFolderName("");
      inputRef.current?.focus();
    }
  };

  const rowHeight = 32; // px per row
  const listHeight = rows * rowHeight;

  const inputBorderClass = invalidFlash
    ? "border-red-500"
    : "border-[var(--border-secondary)] focus:border-blue-500";

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        role="textbox"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={`w-full bg-[var(--bg-tertiary)] rounded px-3 py-2 text-sm border focus:outline-none font-mono ${inputBorderClass}`}
        autoFocus
      />
      <div
        ref={listRef}
        className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)]"
        style={{ height: listHeight }}
        role="listbox"
      >
        {newFolderMode && (
          <div className="px-3 py-1 text-sm flex items-center gap-2 border-b border-[var(--border-secondary)]">
            <Icon path={mdiFolderPlusOutline} size={0.6} className="shrink-0 text-[var(--text-secondary)]" />
            <input
              ref={newFolderInputRef}
              type="text"
              placeholder={i18nT("folders.newFolderName", undefined, "New folder name")}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={handleNewFolderKeyDown}
              className="flex-1 bg-transparent outline-none"
              aria-label={i18nT("folders.newFolderName", undefined, "New folder name")}
            />
          </div>
        )}
        {loading && (
          <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{i18nT("common.loading2", undefined, "Loading…")}</div>
        )}
        {denial && (
          <div className="px-3 py-2 text-sm text-amber-400 flex flex-col gap-1.5">
            <span className="font-medium">{i18nT("common.networkNotAllowed", undefined, "Network not allowed")}</span>
            {denial.hint && <span className="text-amber-300/90">{denial.hint}</span>}
            {onOpenServers && (
              <button
                onClick={onOpenServers}
                className="self-start mt-0.5 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs font-medium cursor-pointer"
              >
                {i18nT("settings.settingsServers", undefined, "Settings → Servers")}
              </button>
            )}
          </div>
        )}
        {error && !denial && (
          <div className="px-3 py-2 text-sm text-red-400">{error}</div>
        )}
        {!loading && !error && !denial && (
          <>
            {displayItems.map((item, i) => {
              const isHighlighted = i === highlightIndex;
              const baseClass = `px-3 py-1 text-sm cursor-pointer flex items-center gap-2 ${
                isHighlighted ? "bg-blue-600/30" : "hover:bg-[var(--bg-secondary)]"
              }`;
              if (item.type === "parent") {
                return (
                  <div
                    key=".."
                    role="option"
                    aria-selected={isHighlighted}
                    className={baseClass}
                    onClick={() => handleItemClick(item)}
                  >
                    {multiSelect && <span className="w-4 shrink-0" aria-hidden="true" />}
                    <Icon path={mdiArrowUp} size={0.6} className="shrink-0 text-[var(--text-secondary)]" />
                    <span>..</span>
                  </div>
                );
              }
              if (item.type === "create-here") {
                return (
                  <div
                    key="__create_here"
                    role="option"
                    aria-selected={isHighlighted}
                    className={`${baseClass} text-blue-400`}
                    onClick={() => handleItemClick(item)}
                  >
                    {multiSelect && <span className="w-4 shrink-0" aria-hidden="true" />}
                    <Icon path={mdiFolderPlusOutline} size={0.6} className="shrink-0" />
                    <span className="flex-1 truncate">{i18nT("common.create2", undefined, "Create \"")}{item.name}{i18nT("common.here", undefined, "\" here")}</span>
                  </div>
                );
              }
              const { entry } = item;
              return (
                <div
                  key={entry.name}
                  role="option"
                  aria-selected={isHighlighted}
                  className={baseClass}
                  onClick={() => handleItemClick(item)}
                >
                  {/* Row anatomy (mockup): [checkbox] [folder] name … [badges]
                      [chevron]. Checkbox = SELECT, everything else = OPEN. */}
                  {selection && (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selection.selected.has(entry.path)}
                      aria-label={i18nT("folders.selectFolder", { name: entry.name }, `Select ${entry.name}`)}
                      // stopPropagation so ticking never navigates.
                      onClick={(e) => {
                        e.stopPropagation();
                        selection.onToggle(entry.path);
                      }}
                      // Glyph stays compact; the hit box is padded to the
                      // WCAG 2.5.8 minimum (24×24) so the small icon is still a
                      // reachable target. See change: redesign-folder-workspace-add-flow.
                      className="focus-ring shrink-0 inline-flex items-center justify-center min-w-6 min-h-6 -m-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-blue)]"
                      data-testid={`path-picker-check-${entry.path}`}
                    >
                      <Icon
                        path={selection.selected.has(entry.path) ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
                        size={0.65}
                      />
                    </button>
                  )}
                  <Icon path={mdiFolder} size={0.6} className="shrink-0 text-[var(--text-secondary)]" />
                  <span className="flex-1 truncate">{entry.name}</span>
                  {(() => {
                    const n = sessionCounts?.get(pathKey(entry.path, inferPlatform([entry.path])));
                    return n ? (
                      <span
                        className="text-[10px] px-1.5 py-px rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] shrink-0"
                        data-testid={`path-picker-sessions-${entry.path}`}
                      >
                        {i18nT("folders.sessionCount", { count: n }, `${n} sessions`)}
                      </span>
                    ) : null;
                  })()}
                  {entry.isGit && (
                    <span className="text-xs text-green-400" title={i18nT("git.gitRepo", undefined, "git repo")}>git</span>
                  )}
                  {entry.isPi && (
                    <span className="text-xs text-cyan-400" title={i18nT("common.piProject", undefined, "pi project")}>pi</span>
                  )}
                  {/* Explicit descend affordance — makes "open" discoverable
                      rather than merely implied by the row being clickable. */}
                  {multiSelect && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(item);
                      }}
                      // Padded to the 24×24 WCAG 2.5.8 minimum (see checkbox).
                      className="focus-ring shrink-0 inline-flex items-center justify-center min-w-6 min-h-6 -m-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-blue)]"
                      title={i18nT("common.open", undefined, "Open")}
                      aria-label={i18nT("folders.openFolder", { name: entry.name }, `Open ${entry.name}`)}
                      data-testid={`path-picker-open-${entry.path}`}
                    >
                      <Icon path={mdiChevronRight} size={0.6} />
                    </button>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && !createHereAvailable && entries.length === 0 && partial === "" && (
              <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{i18nT("common.noSubdirectories", undefined, "No subdirectories")}</div>
            )}
            {filtered.length === 0 && !createHereAvailable && partial !== "" && (
              <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{i18nT("common.noMatches", undefined, "No matches")}</div>
            )}
          </>
        )}
      </div>
      {/* Multi-select owns no answer, so Cancel/Select belong to the hosting
          dialog's footer — only "New folder" stays with the picker.
          See change: redesign-folder-workspace-add-flow. */}
      <div className={`flex flex-wrap gap-2 mt-2 ${multiSelect ? "justify-start" : "justify-end"}`}>
        {!multiSelect && (
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        )}
        <button
          onClick={() => {
            setNewFolderMode(true);
            setNewFolderName("");
          }}
          className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] inline-flex items-center gap-1.5"
        >
          <Icon path={mdiFolderPlusOutline} size={0.65} />
          {i18nT("folders.newFolder", undefined, "New folder")}
        </button>
        {!multiSelect && (
          <button
            onClick={() => {
              void (async () => {
                const handled = await tryConfirm();
                if (!handled) triggerInvalid();
              })();
            }}
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {i18nT("common.select", undefined, "Select")}
          </button>
        )}
      </div>
    </div>
  );
}
