/**
 * Narrow open-files watcher for the editor pane's changed-on-disk banner.
 *
 * Scope is the pane's **open files only** — not the whole `cwd` tree. Watchers
 * are keyed per (connection, sessionId, relPath) so a browser declares exactly
 * which files it has open (`watch_files`) and the server reconciles the set:
 * new paths get an `fs.watch`, gone paths are closed. `clearConnection` tears
 * every watcher for a disconnected browser down so no file descriptors leak.
 *
 * Best-effort: `fs.watch` is path-based, and a rename-in-place edit (tmp +
 * rename) detaches the watch from the new inode. On a `rename` event the
 * watcher therefore re-attaches synchronously when the path is a regular file
 * again, else re-probes at 100/300/600/1000 ms and then drops the key. The
 * banner is a hint, not a guarantee; the pane's manual refresh stays
 * authoritative.
 *
 * See change: split-editor-workspace, add-editor-pane-file-handlers
 * (minimal slice of gate-changed-on-disk-by-content D5).
 */

import { existsSync, type FSWatcher, statSync, watch } from "node:fs";
import path from "node:path";

/** Synchronous logical containment: `abs` equals or sits under `cwd`. */
function withinCwd(abs: string, cwd: string): boolean {
  const rel = path.relative(cwd, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type FileChangeListener = (sessionId: string, relPath: string) => void;

interface WatchKey {
  sessionId: string;
  relPath: string;
}

export interface FileWatchManager {
  /**
   * Reconcile the watched set for (ws, sessionId) to exactly `relPaths`. Adds
   * watchers for new paths, closes watchers for removed paths. `onChange` fires
   * with (sessionId, relPath) on a change event (debounced per watcher).
   */
  setWatched(ws: object, sessionId: string, cwd: string, relPaths: string[], onChange: FileChangeListener): void;
  /** Tear down every watcher held by a connection (call on ws close). */
  clearConnection(ws: object): void;
  /** Total live `fs.watch` handles (tests / diagnostics). */
  activeWatchCount(): number;
}

const CHANGE_DEBOUNCE_MS = 40;
/** Delays (ms after the `rename` event) at which a vanished path is re-probed before the key is dropped. */
const REATTACH_RETRY_AT_MS = [100, 300, 600, 1000] as const;

/** Per-key state. The debounce timer lives here (not on a watcher) so it survives a re-attach. */
interface WatchEntry {
  /** Current `fs.watch` handle; `null` while waiting for a deleted path to reappear. */
  watcher: FSWatcher | null;
  debounce: NodeJS.Timeout | null;
  retry: NodeJS.Timeout | null;
}

function isRegularFileSync(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function closeWatcherQuietly(w: FSWatcher | null): void {
  try {
    w?.close();
  } catch {
    /* already closed */
  }
}

export function createFileWatchManager(): FileWatchManager {
  // ws → keyString → entry. keyString = `${sessionId}\u0000${relPath}`.
  const byConnection = new Map<object, Map<string, WatchEntry>>();

  const keyOf = (k: WatchKey) => `${k.sessionId}\u0000${k.relPath}`;

  /**
   * Cancel timers, close the handle, forget the key. Safe to call twice.
   * `keepPending`: a path dropped because it vanished must still report that
   * change, so its already-scheduled (<= 40 ms) debounce is left to fire.
   */
  function closeWatcher(map: Map<string, WatchEntry>, keyString: string, keepPending = false): void {
    const entry = map.get(keyString);
    if (!entry) return;
    if (entry.debounce && !keepPending) clearTimeout(entry.debounce);
    if (entry.retry) clearTimeout(entry.retry);
    if (!keepPending) entry.debounce = null;
    entry.retry = null;
    closeWatcherQuietly(entry.watcher);
    entry.watcher = null;
    map.delete(keyString);
  }

  /**
   * Attach an `fs.watch` for `entry` and wire its events. Every callback checks
   * `entry.watcher === w`, so a superseded watcher can neither schedule changes
   * nor close its successor. Returns false when the path is unwatchable.
   */
  function attach(
    map: Map<string, WatchEntry>,
    keyString: string,
    entry: WatchEntry,
    abs: string,
    notify: () => void,
  ): boolean {
    try {
      const w: FSWatcher = watch(abs, (eventType) => {
        if (entry.watcher !== w) return; // superseded
        schedule(entry, notify);
        // Atomic replace (tmp + rename) detaches the watch from the old inode:
        // `rename` is the signal to follow the path to its new inode.
        if (eventType === "rename") reattach(map, keyString, entry, abs, notify);
      });
      w.on("error", () => {
        if (entry.watcher === w) closeWatcher(map, keyString);
      });
      entry.watcher = w;
      return true;
    } catch {
      return false;
    }
  }

  function schedule(entry: WatchEntry, notify: () => void): void {
    if (entry.debounce) return; // debounce a burst of events into one
    entry.debounce = setTimeout(() => {
      entry.debounce = null;
      notify();
    }, CHANGE_DEBOUNCE_MS);
  }

  /** Synchronous re-attach when the path is a regular file again, else bounded retries, then drop. */
  function reattach(
    map: Map<string, WatchEntry>,
    keyString: string,
    entry: WatchEntry,
    abs: string,
    notify: () => void,
  ): void {
    closeWatcherQuietly(entry.watcher);
    entry.watcher = null;
    if (isRegularFileSync(abs)) {
      if (attach(map, keyString, entry, abs, notify)) return;
    } else if (existsSync(abs)) {
      closeWatcher(map, keyString, true); // replaced by a directory etc.: never watch it
      return;
    }
    let attempt = 0;
    const tick = (): void => {
      entry.retry = null;
      if (map.get(keyString) !== entry) return; // torn down meanwhile
      if (isRegularFileSync(abs) && attach(map, keyString, entry, abs, notify)) {
        schedule(entry, notify); // the file reappeared after the last candidate
        return;
      }
      attempt++;
      if (attempt >= REATTACH_RETRY_AT_MS.length) {
        closeWatcher(map, keyString, true);
        return;
      }
      entry.retry = setTimeout(tick, REATTACH_RETRY_AT_MS[attempt] - REATTACH_RETRY_AT_MS[attempt - 1]);
      entry.retry.unref?.();
    };
    entry.retry = setTimeout(tick, REATTACH_RETRY_AT_MS[0]);
    entry.retry.unref?.();
  }

  /** Close this session's watchers whose key is no longer desired (other sessions untouched). */
  function removeUndesired(map: Map<string, WatchEntry>, sessionId: string, desired: Set<string>): void {
    const sessionPrefix = `${sessionId}\u0000`;
    for (const existing of [...map.keys()]) {
      if (existing.startsWith(sessionPrefix) && !desired.has(existing)) closeWatcher(map, existing);
    }
  }

  /** Watch `rel` under `cwd` (synchronous, cwd-contained); unwatchable paths are skipped. */
  function addWatcher(
    map: Map<string, WatchEntry>,
    keyString: string,
    abs: string,
    notify: () => void,
  ): void {
    const entry: WatchEntry = { watcher: null, debounce: null, retry: null };
    if (attach(map, keyString, entry, abs, notify)) map.set(keyString, entry);
  }

  return {
    setWatched(ws, sessionId, cwd, relPaths, onChange) {
      let map = byConnection.get(ws);
      if (!map) {
        map = new Map();
        byConnection.set(ws, map);
      }
      removeUndesired(map, sessionId, new Set(relPaths.map((rel) => keyOf({ sessionId, relPath: rel }))));
      for (const rel of relPaths) {
        const keyString = keyOf({ sessionId, relPath: rel });
        if (map.has(keyString)) continue; // already watched
        const abs = path.resolve(cwd, rel);
        if (!withinCwd(abs, cwd)) continue; // never watch outside cwd
        addWatcher(map, keyString, abs, () => onChange(sessionId, rel));
      }
    },

    clearConnection(ws) {
      const map = byConnection.get(ws);
      if (!map) return;
      for (const key of [...map.keys()]) closeWatcher(map, key);
      byConnection.delete(ws);
    },

    activeWatchCount() {
      let n = 0;
      for (const map of byConnection.values()) n += map.size;
      return n;
    },
  };
}
