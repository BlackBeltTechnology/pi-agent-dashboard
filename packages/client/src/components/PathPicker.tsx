import React, { useState, useEffect, useRef, useCallback } from "react";
import { browseDirectory, createDirectory } from "../lib/browse-api.js";
import type { BrowseResult, BrowseEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { parsePathInput, withTrailingSep } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { inferPlatform } from "../lib/session-grouping.js";

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  rows?: number;
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

export function PathPicker({ initialPath, onSelect, onCancel, rows = 8 }: Props) {
  const [inputValue, setInputValue] = useState(initialPath ?? "");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      try {
        const result = await browseDirectory(dir, { q, signal: ctrl.signal });
        // Ignore stale response if a newer request superseded us
        if (abortRef.current !== ctrl) return;
        fetchedDirRef.current = result.current;
        fetchedQRef.current = q;
        setEntries(result.entries);
        setParentPath(result.parent);
        setHighlightIndex(-1);
        return result;
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        if (e?.name === "AbortError") return;
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
      fetchDir(undefined, "").then((result) => {
        if (result) {
          // Append OS-native separator using the platform the server
          // reports (falls back to inference if absent for backward-
          // compat with older servers).
          const platform = result.platform ?? inferPlatform([result.current]);
          setInputValue(withTrailingSep(result.current, platform));
        }
      });
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
    setInputValue(value);
    setHighlightIndex(-1);
    const { parent, partial: newPartial } = parseInput(value);
    scheduleFetch(parent, newPartial);
  };

  const descendInto = (dirPath: string) => {
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

    // Rule 2: input ends with "/" and parsed parent equals the fetched dir
    if (inputValue.endsWith("/") && fetchedDirRef.current === p) {
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If the highlighted item is the create-here row, trigger it
      if (highlightIndex >= 0 && highlightIndex < displayItems.length) {
        const item = displayItems[highlightIndex];
        if (item.type === "create-here") {
          handleItemClick(item);
          return;
        }
      }
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
            <span className="text-[var(--text-secondary)]">＋</span>
            <input
              ref={newFolderInputRef}
              type="text"
              placeholder="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={handleNewFolderKeyDown}
              className="flex-1 bg-transparent outline-none"
              aria-label="New folder name"
            />
          </div>
        )}
        {loading && (
          <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">Loading…</div>
        )}
        {error && (
          <div className="px-3 py-2 text-sm text-red-400">{error}</div>
        )}
        {!loading && !error && (
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
                    <span className="text-[var(--text-secondary)]">⬆</span>
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
                    <span>＋</span>
                    <span className="flex-1 truncate">Create "{item.name}" here</span>
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
                  <span className="text-[var(--text-secondary)]">📁</span>
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.isGit && (
                    <span className="text-xs text-green-400" title="git repo">git</span>
                  )}
                  {entry.isPi && (
                    <span className="text-xs text-cyan-400" title="pi project">pi</span>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && !createHereAvailable && entries.length === 0 && partial === "" && (
              <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">No subdirectories</div>
            )}
            {filtered.length === 0 && !createHereAvailable && partial !== "" && (
              <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">No matches</div>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            setNewFolderMode(true);
            setNewFolderName("");
          }}
          className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]"
        >
          ＋ New folder
        </button>
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
          Select
        </button>
      </div>
    </div>
  );
}
