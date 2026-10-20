import { parsePathInput, withTrailingSep } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import type { BrowseEntry, BrowseResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiArrowUp, mdiCheck, mdiFolder, mdiFolderPlusOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { browserIsMacLike } from "../../hooks/useHostPlatform.js";
import { browseDirectory, classifyPaths, createDirectory } from "../../lib/api/browse-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { applyRowClick, isAddToSelectionModifier, type SelectionPlatform } from "../../lib/selection-modifier.js";
import { inferPlatform, pathKey } from "../../lib/session/session-grouping.js";

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
   * single-select. Present, the picker behaves like an OS file manager: click
   * selects, the platform modifier toggles, Shift ranges, double-click (or a
   * touch tap) opens, long-press selects on touch. The picker OWNS the
   * selection (scoped to the browsed folder, cleared whenever it changes) and
   * reports it upward; it never calls `onSelect` from a row.
   * See change: simplify-add-folder-picker (design D1–D9).
   */
  selection?: {
    /** Fires after every selection change and every change of the browsed folder. */
    onChange: (state: { selected: string[]; current: string | null; isHome: boolean }) => void;
    /** `pathKey`s of already-added folders — their rows render an `added` marker. */
    pinnedKeys?: Set<string>;
    /** Bump to clear the selection from the host (e.g. a status-line Clear). */
    clearRequest?: number;
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
/** Touch hold that enters select mode (design D3). */
const LONG_PRESS_MS = 400;
/** Finger travel (px) that cancels a pending long-press. */
const LONG_PRESS_SLOP_PX = 10;

type DisplayItem =
  | { type: "parent" }
  | { type: "entry"; entry: BrowseEntry }
  | { type: "create-here"; name: string };

interface RowSel {
  selected: string[];
  anchor: string | null;
  /** Keyboard cursor (drives `aria-activedescendant`); may differ from the anchor during Shift+Arrow. */
  cursor: string | null;
}
const EMPTY_SEL: RowSel = { selected: [], anchor: null, cursor: null };

const keyOf = (p: string) => pathKey(p, inferPlatform([p]));

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

  // ---- Multi-select (file-manager) state. See change: simplify-add-folder-picker.
  const [sel, setSel] = useState<RowSel>(EMPTY_SEL);
  // Touch select mode: entered by long-press, left when the last row is deselected.
  const [selectMode, setSelectMode] = useState(false);
  // Browsed directory as STATE (fetchedDirRef is a ref and cannot drive onChange).
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  // "Home" = `current` of the first no-path browse (design D9). Never set when
  // the picker opens on an explicit initialPath.
  const homeRef = useRef<string | null>(null);
  // `click`/`dblclick` carry no pointer type; pointerdown records it (design D3).
  const lastPointerTypeRef = useRef<string>("mouse");
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const onChangeRef = useRef(selection?.onChange);
  onChangeRef.current = selection?.onChange;
  const platform: SelectionPlatform = useMemo(() => (browserIsMacLike() ? "mac" : "other"), []);
  const [coarse] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  );
  const listId = useId();

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
        if (dir === undefined && homeRef.current === null) homeRef.current = result.current;
        // Every navigation (row open, `..`, typed path, mount, create-folder)
        // lands here: selection is scoped to the browsed folder (design D1).
        if (fetchedDirRef.current !== result.current) {
          setSel(EMPTY_SEL);
          setSelectMode(false);
        }
        fetchedDirRef.current = result.current;
        setCurrentDir(result.current);
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

  // ---- Multi-select gestures (design D2–D8) ----------------------------------
  const ordered = useMemo(() => entries.map((e) => e.path), [entries]);
  const selectedSet = useMemo(() => new Set(sel.selected), [sel.selected]);
  const isHome =
    currentDir !== null && homeRef.current !== null && keyOf(currentDir) === keyOf(homeRef.current);

  // Layout effect: the host's targets update BEFORE paint, so a click on the
  // freshly rendered listing can never commit the folder just left (test-plan F9).
  useLayoutEffect(() => {
    onChangeRef.current?.({ selected: sel.selected, current: currentDir, isHome });
  }, [sel.selected, currentDir, isHome]);

  const clearRequest = selection?.clearRequest;
  useEffect(() => {
    if (!clearRequest) return;
    setSel(EMPTY_SEL);
    setSelectMode(false);
  }, [clearRequest]);

  const clearSelection = () => {
    setSel(EMPTY_SEL);
    setSelectMode(false);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };
  useEffect(() => cancelLongPress, []);

  const handleRowPointerDown = (e: React.PointerEvent, path: string) => {
    lastPointerTypeRef.current = e.pointerType || "mouse";
    suppressNextClickRef.current = false;
    cancelLongPress();
    if (e.pointerType !== "touch") return;
    const timer = setTimeout(() => {
      longPressRef.current = null;
      // Chromium fires `click` after the hold, iOS does not — swallow at most one.
      suppressNextClickRef.current = true;
      setSelectMode(true);
      setSel((prev) => ({
        selected: prev.selected.includes(path) ? prev.selected : [...prev.selected, path],
        anchor: path,
        cursor: path,
      }));
    }, LONG_PRESS_MS);
    longPressRef.current = { timer, x: e.clientX, y: e.clientY };
  };

  const handleRowPointerMove = (e: React.PointerEvent) => {
    const lp = longPressRef.current;
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP_PX) cancelLongPress();
  };

  const handleEntryClick = (e: React.MouseEvent, path: string) => {
    if (lastPointerTypeRef.current === "touch") {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (!selectMode) {
        descendInto(path);
        return;
      }
      const selected = selectedSet.has(path) ? sel.selected.filter((p) => p !== path) : [...sel.selected, path];
      setSel({ selected, anchor: path, cursor: path });
      if (selected.length === 0) setSelectMode(false);
      return;
    }
    const next = applyRowClick(sel, {
      path,
      ordered,
      mod: isAddToSelectionModifier(e, platform),
      shift: e.shiftKey,
    });
    setSel({ ...next, cursor: path });
    inputRef.current?.focus();
  };

  // Backspace / select-all act on the list only while the input shows the
  // browsed folder unedited; otherwise they edit text (design D8).
  const inputAtCurrent =
    partial === "" && fetchedDirRef.current !== null && keyOf(currentParent) === keyOf(fetchedDirRef.current);

  const goUp = () => {
    if (parentPath) descendInto(parentPath);
  };

  const moveCursor = (delta: 1 | -1, shift: boolean) => {
    if (ordered.length === 0) return;
    const cur = sel.cursor ? ordered.indexOf(sel.cursor) : -1;
    const next = ordered[cur < 0 ? 0 : Math.min(Math.max(cur + delta, 0), ordered.length - 1)];
    const a = sel.anchor ? ordered.indexOf(sel.anchor) : -1;
    if (shift && a >= 0) {
      const n = ordered.indexOf(next);
      const [lo, hi] = n < a ? [n, a] : [a, n];
      setSel({ selected: ordered.slice(lo, hi + 1), anchor: sel.anchor, cursor: next });
    } else {
      setSel({ selected: [next], anchor: next, cursor: next });
    }
  };

  const openFromKeyboard = () => {
    if (sel.selected.length === 1) {
      descendInto(sel.selected[0]);
    } else if (exactMatch) {
      descendInto(exactMatch.path);
    } else if (pendingFetchRef.current) {
      void pendingFetchRef.current();
    }
  };

  const handleMultiKeyDown = (e: React.KeyboardEvent) => {
    const arrow = e.key === "ArrowUp" || e.key === "ArrowDown";
    if (e.key === "ArrowUp" && (platform === "mac" ? e.metaKey : e.altKey)) {
      e.preventDefault();
      goUp();
    } else if (e.key === "Enter" || (e.key === "ArrowDown" && platform === "mac" && e.metaKey)) {
      e.preventDefault();
      openFromKeyboard();
    } else if (arrow && (e.metaKey || e.altKey)) {
      // The other platform's go-up/open chord: swallow, do nothing.
      e.preventDefault();
    } else if (arrow) {
      e.preventDefault();
      moveCursor(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
    } else if (e.key === "Backspace" && inputAtCurrent) {
      e.preventDefault();
      goUp();
    } else if (e.key.toLowerCase() === "a" && isAddToSelectionModifier(e, platform) && inputAtCurrent) {
      e.preventDefault();
      setSel({ selected: ordered, anchor: ordered[0] ?? null, cursor: ordered[0] ?? null });
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (sel.selected.length > 0) {
        // defaultPrevented makes the Dialog escape layer stand down (escape-stack.ts).
        e.stopPropagation();
        clearSelection();
      } else {
        onCancel();
      }
    }
    // Tab and Space are deliberately not handled: focus moves on / literal space.
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (multiSelect) {
      handleMultiKeyDown(e);
      return;
    }
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

  // Multi-select: keep the keyboard cursor row in view.
  const rowId = (path: string) => `${listId}-row-${ordered.indexOf(path)}`;
  const cursorId = multiSelect && sel.cursor && ordered.includes(sel.cursor) ? rowId(sel.cursor) : undefined;
  useEffect(() => {
    if (cursorId) document.getElementById(cursorId)?.scrollIntoView?.({ block: "nearest" });
  }, [cursorId]);

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

  // 44 px touch targets on a coarse pointer in multi-select (design D3).
  const touchRows = multiSelect && coarse;
  const rowHeight = touchRows ? 44 : 32; // px per row
  const listHeight = rows * rowHeight;
  const multiRowStyle = touchRows ? { minHeight: rowHeight } : undefined;

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
        aria-controls={multiSelect ? listId : undefined}
        aria-activedescendant={cursorId}
        autoFocus
      />
      <div
        ref={listRef}
        id={listId}
        className="overflow-y-auto border border-[var(--border-secondary)] rounded bg-[var(--bg-tertiary)]"
        style={{ height: listHeight }}
        role="listbox"
        aria-multiselectable={multiSelect ? true : undefined}
        // Click on empty list space clears the selection (file-manager norm).
        onClick={multiSelect ? (e) => { if (e.target === e.currentTarget) clearSelection(); } : undefined}
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
              const isHighlighted = !multiSelect && i === highlightIndex;
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
                    style={multiRowStyle}
                    // `..` stays single-click in every mode (design: Risks).
                    onClick={() => handleItemClick(item)}
                  >
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
                    style={multiRowStyle}
                    onClick={() => handleItemClick(item)}
                  >
                    <Icon path={mdiFolderPlusOutline} size={0.6} className="shrink-0" />
                    <span className="flex-1 truncate">{i18nT("common.create2", undefined, "Create \"")}{item.name}{i18nT("common.here", undefined, "\" here")}</span>
                  </div>
                );
              }
              const { entry } = item;
              const isSel = multiSelect && selectedSet.has(entry.path);
              const isAdded = multiSelect && !!selection?.pinnedKeys?.has(keyOf(entry.path));
              // Rows are keyed by entry.name and selection only flips aria/class:
              // a remount between the two clicks would suppress dblclick (design D5).
              const rowClass = multiSelect
                ? `px-3 py-1 text-sm cursor-pointer flex items-center gap-2 select-none ${
                    // Accent bar + check mark: selection is never colour-only.
                    isSel ? "bg-[var(--accent-blue)]/20 shadow-[inset_3px_0_0_var(--accent-blue)]" : "hover:bg-[var(--bg-secondary)]"
                  }`
                : baseClass;
              return (
                <div
                  key={entry.name}
                  id={multiSelect ? rowId(entry.path) : undefined}
                  role="option"
                  aria-selected={multiSelect ? isSel : isHighlighted}
                  className={rowClass}
                  style={multiSelect ? { ...multiRowStyle, touchAction: "pan-y" } : undefined}
                  data-testid={multiSelect ? `path-picker-row-${entry.path}` : undefined}
                  onClick={multiSelect ? (e) => handleEntryClick(e, entry.path) : () => handleItemClick(item)}
                  onDoubleClick={
                    multiSelect
                      ? () => {
                          if (lastPointerTypeRef.current !== "touch") descendInto(entry.path);
                        }
                      : undefined
                  }
                  onPointerDown={multiSelect ? (e) => handleRowPointerDown(e, entry.path) : undefined}
                  onPointerMove={multiSelect ? handleRowPointerMove : undefined}
                  onPointerUp={multiSelect ? cancelLongPress : undefined}
                  onPointerCancel={multiSelect ? cancelLongPress : undefined}
                  onContextMenu={
                    multiSelect
                      ? (e) => {
                          // Stops the iOS/Android long-press callout; mouse right-click unaffected.
                          if (lastPointerTypeRef.current === "touch") e.preventDefault();
                        }
                      : undefined
                  }
                >
                  <Icon path={mdiFolder} size={0.6} className="shrink-0 text-[var(--text-secondary)]" />
                  <span className="flex-1 truncate">{entry.name}</span>
                  {isAdded && (
                    <span
                      className="text-[11px] px-1.5 py-px rounded-full border border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-primary)] shrink-0"
                      data-testid={`path-picker-added-${entry.path}`}
                    >
                      {i18nT("folders.addedBadge", undefined, "added")}
                    </span>
                  )}
                  {(() => {
                    const n = sessionCounts?.get(keyOf(entry.path));
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
                    <span className="text-xs text-[var(--accent-green-text)]" title={i18nT("git.gitRepo", undefined, "git repo")}>git</span>
                  )}
                  {entry.isPi && (
                    <span className="text-xs text-[var(--text-secondary)]" title={i18nT("common.piProject", undefined, "pi project")}>pi</span>
                  )}
                  {multiSelect && (
                    <Icon
                      path={mdiCheck}
                      size={0.6}
                      aria-hidden="true"
                      className={`shrink-0 text-[var(--accent-blue-text)] ${isSel ? "" : "invisible"}`}
                      data-testid={isSel ? `path-picker-check-mark-${entry.path}` : undefined}
                    />
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && !createHereAvailable && entries.length === 0 && partial === "" && (
              multiSelect ? (
                <div
                  className="m-3 p-3.5 rounded-lg border border-dashed border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[13px] text-[var(--text-secondary)]"
                  data-testid="path-picker-empty"
                >
                  <div className="font-semibold text-[var(--text-primary)] mb-0.5">
                    {i18nT("folders.emptyTitle", undefined, "No subfolders here")}
                  </div>
                  {i18nT("folders.emptyHint", undefined, "Type a path above to open another folder, or use New folder to create one.")}
                </div>
              ) : (
                <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{i18nT("common.noSubdirectories", undefined, "No subdirectories")}</div>
              )
            )}
            {filtered.length === 0 && !createHereAvailable && partial !== "" && (
              <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{i18nT("common.noMatches", undefined, "No matches")}</div>
            )}
          </>
        )}
      </div>
      {multiSelect && (
        <div className="sr-only" aria-live="polite" data-testid="path-picker-live">
          {sel.selected.length > 0
            ? i18nT("folders.selectedCount", { count: sel.selected.length }, `${sel.selected.length} selected`)
            : ""}
        </div>
      )}
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
            className="px-4 py-2 rounded text-sm bg-[var(--accent-solid)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {i18nT("common.select", undefined, "Select")}
          </button>
        )}
      </div>
    </div>
  );
}
