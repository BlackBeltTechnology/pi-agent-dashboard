/**
 * Global UI preferences store — JSON-backed with debounced writes.
 * Stores cross-session state: pinned directories and session ordering.
 * Replaces `state-store.ts` (hidden state moved to per-session `.meta.json`).
 */
import path from "node:path";
import { CONFIG_DIR } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { safeRealpathSync } from "./resolve-path.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

export const PREFERENCES_FILE = path.join(CONFIG_DIR, "preferences.json");

interface PreferencesData {
  sessionOrder: Record<string, string[]>;
  pinnedDirectories: string[];
}

export interface PreferencesStore {
  getSessionOrder(): Record<string, string[]>;
  setSessionOrder(order: Record<string, string[]>): void;
  getPinnedDirectories(): string[];
  setPinnedDirectories(dirs: string[]): void;
  pinDirectory(dirPath: string): void;
  unpinDirectory(dirPath: string): void;
  reorderPinnedDirs(dirs: string[]): void;
  flush(): void;
  dispose(): void;
}

const DEBOUNCE_MS = 1000;

export function createPreferencesStore(filePath: string = PREFERENCES_FILE): PreferencesStore {
  const data: PreferencesData = readJsonFile<PreferencesData>(filePath, { sessionOrder: {}, pinnedDirectories: [] });
  let sessionOrder: Record<string, string[]> = data.sessionOrder ?? {};
  // Normalize + resolve symlinks in stored pinned paths on load. Normalize
  // FIRST so cosmetic drift (trailing separator, mixed separators,
  // drive-letter case on Windows) collapses before realpath — then
  // realpath handles symlinks. Order matters: realpath can fail for
  // not-yet-existing paths, so we keep its best-effort fallback.
  // See change: platform-path-normalization.
  const rawPinned = data.pinnedDirectories ?? [];
  // IMPORTANT: wrap in arrow fn — `Array.prototype.map` passes `(element,
  // index, array)`, and `normalizePath`'s 2nd param is a `platform:
  // NodeJS.Platform`. Passing the index (a number) silently disables the
  // Windows branch at runtime.
  let pinnedDirectories: string[] = rawPinned
    .map((p) => normalizePath(p))
    .map((p) => safeRealpathSync(p));
  // Deduplicate post-normalization. Two previously-different entries that
  // collapse to the same canonical form (e.g., with and without trailing
  // slash) become one stored entry.
  pinnedDirectories = [...new Set(pinnedDirectories)];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = pinnedDirectories.length !== rawPinned.length || pinnedDirectories.some((p, i) => p !== rawPinned[i]);

  function scheduleSave(): void {
    dirty = true;
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (dirty) {
        dirty = false;
        writeJsonFile(filePath, { sessionOrder, pinnedDirectories } satisfies PreferencesData);
      }
    }, DEBOUNCE_MS);
  }

  function flushNow(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (dirty) {
      dirty = false;
      writeJsonFile(filePath, { sessionOrder, pinnedDirectories } satisfies PreferencesData);
    }
  }

  if (dirty) scheduleSave();

  return {
    getSessionOrder(): Record<string, string[]> {
      return sessionOrder;
    },

    setSessionOrder(order: Record<string, string[]>): void {
      sessionOrder = order;
      scheduleSave();
    },

    getPinnedDirectories(): string[] {
      return [...pinnedDirectories];
    },

    setPinnedDirectories(dirs: string[]): void {
      pinnedDirectories = [...dirs];
      scheduleSave();
    },

    pinDirectory(dirPath: string): void {
      if (pinnedDirectories.includes(dirPath)) return;
      pinnedDirectories.push(dirPath);
      scheduleSave();
    },

    unpinDirectory(dirPath: string): void {
      const idx = pinnedDirectories.indexOf(dirPath);
      if (idx === -1) return;
      pinnedDirectories.splice(idx, 1);
      scheduleSave();
    },

    reorderPinnedDirs(dirs: string[]): void {
      pinnedDirectories = [...dirs];
      scheduleSave();
    },

    flush(): void {
      flushNow();
    },

    dispose(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
