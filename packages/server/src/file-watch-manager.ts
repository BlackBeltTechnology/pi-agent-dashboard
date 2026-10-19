/**
 * Narrow open-files watcher for the editor pane's changed-on-disk banner.
 *
 * Scope is the pane's **open files only** — not the whole `cwd` tree. Watchers
 * are keyed per (connection, sessionId, relPath) so a browser declares exactly
 * which files it has open (`watch_files`) and the server reconciles the set:
 * new paths get an `fs.watch`, gone paths are closed. `clearConnection` tears
 * every watcher for a disconnected browser down so no file descriptors leak.
 *
 * `fs.watch` is path-based but binds to the inode, so an atomic replace
 * (tmp + `rename`: the pane's own Save, formatters, `git checkout`) leaves the
 * watcher on the old inode and later changes would go unseen. On a `rename`
 * event the entry therefore re-attaches SYNCHRONOUSLY to the path (only if it
 * is a regular file); a path that is missing (delete + quick re-create) is
 * retried at 100/300/600/1000 ms, then the key is dropped. A path replaced by a
 * non-regular file (directory, FIFO) drops the key at once. `change` events
 * never re-attach (no fd churn). Every event is still only a *candidate*: the
 * client verifies it against a content digest before showing the banner.
 *
 * Timers (retry + debounce) live on the per-key entry and are cancelled by
 * reconcile-removal / `clearConnection`, so no retry can resurrect a dropped
 * key. Handlers act only on the watcher instance the entry still holds, so a
 * stale `error`/event from a replaced watcher never touches its successor.
 *
 * See change: split-editor-workspace, gate-changed-on-disk-by-content (D5).
 */

import { type FSWatcher, statSync, watch } from "node:fs";
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
  /** Pending retry + debounce timers on held keys (tests / diagnostics). */
  pendingTimerCount(): number;
}

/** Test seams: the `fs.watch` factory. */
export interface FileWatchManagerDeps {
  watchFn?: typeof watch;
}

const CHANGE_DEBOUNCE_MS = 40;
/** Delays (ms after the `rename`) at which a missing path is retried before the key is dropped. */
const REATTACH_RETRY_DELAYS_MS = [100, 300, 600, 1000] as const;

type PathState = "file" | "other" | "missing";

function pathState(abs: string): PathState {
  try {
    return statSync(abs).isFile() ? "file" : "other";
  } catch {
    return "missing";
  }
}

/**
 * One watched (connection, session, path) key: the live `fs.watch` handle plus
 * the retry and debounce timers that belong to it. `drop` is invoked when the
 * key must leave the manager's map (retries exhausted, non-regular file,
 * watcher error); `release` frees the handle + retry timer, `cancel` also
 * silences a pending debounce so nothing fires after a teardown.
 */
class WatchedFile {
  private watcher: FSWatcher | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private cancelled = false;

  private readonly abs: string;
  private readonly watchFn: typeof watch;
  private readonly emit: () => void;
  private readonly drop: (self: WatchedFile) => void;

  constructor(abs: string, watchFn: typeof watch, emit: () => void, drop: (self: WatchedFile) => void) {
    this.abs = abs;
    this.watchFn = watchFn;
    this.emit = emit;
    this.drop = drop;
  }

  hasWatcher(): boolean {
    return this.watcher !== null;
  }

  pendingTimers(): number {
    return (this.retryTimer ? 1 : 0) + (this.debounceTimer ? 1 : 0);
  }

  /** Bind a fresh watcher to the path. Throws if the path cannot be watched. */
  attach(): void {
    const watcher = this.watchFn(this.abs, (eventType) => {
      if (this.watcher !== watcher) return; // stale instance
      if (eventType === "rename") this.reattach();
      this.scheduleChange();
    });
    watcher.on("error", () => {
      // Act only on the instance still held: an old watcher's late `error`
      // must not close its re-attached successor.
      if (this.watcher === watcher) this.drop(this);
    });
    this.watcher = watcher;
  }

  /** Free the handle + retry timer; a pending debounce still fires once. */
  release(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.closeHandle();
  }

  /** Explicit teardown: release AND cancel the debounce. */
  cancel(): void {
    this.cancelled = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.release();
  }

  private closeHandle(): void {
    const w = this.watcher;
    this.watcher = null;
    try {
      w?.close();
    } catch {
      /* already closed */
    }
  }

  private scheduleChange(): void {
    if (this.debounceTimer) return; // debounce a burst of events into one
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.cancelled) this.emit();
    }, CHANGE_DEBOUNCE_MS);
  }

  /** `rename`: the old inode is gone — bind to whatever is at the path now. */
  private reattach(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.closeHandle();
    const state = pathState(this.abs);
    if (state === "other") return this.drop(this); // never watch a directory / FIFO
    if (state === "file" && this.tryAttach()) return;
    this.retry(0);
  }

  private tryAttach(): boolean {
    try {
      this.attach();
      return true;
    } catch {
      return false; // vanished between stat and watch
    }
  }

  /** Retry a missing path at the bounded delays, then drop the key. */
  private retry(attempt: number): void {
    if (attempt >= REATTACH_RETRY_DELAYS_MS.length) return this.drop(this);
    const prev = attempt === 0 ? 0 : REATTACH_RETRY_DELAYS_MS[attempt - 1];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const state = pathState(this.abs);
      if (state === "other") return this.drop(this);
      if (state === "file" && this.tryAttach()) return this.scheduleChange(); // re-created: have the client re-verify
      this.retry(attempt + 1);
    }, REATTACH_RETRY_DELAYS_MS[attempt] - prev);
  }
}

export function createFileWatchManager(deps: FileWatchManagerDeps = {}): FileWatchManager {
  const watchFn = deps.watchFn ?? watch;
  // ws → keyString → entry. keyString = `${sessionId}\u0000${relPath}`.
  const byConnection = new Map<object, Map<string, WatchedFile>>();

  const keyOf = (k: WatchKey) => `${k.sessionId}\u0000${k.relPath}`;

  function closeEntry(map: Map<string, WatchedFile>, keyString: string): void {
    map.get(keyString)?.cancel();
    map.delete(keyString);
  }

  function addWatch(
    map: Map<string, WatchedFile>,
    keyString: string,
    abs: string,
    emit: () => void,
  ): void {
    const entry = new WatchedFile(abs, watchFn, emit, (self) => {
      self.release();
      if (map.get(keyString) === self) map.delete(keyString);
    });
    try {
      entry.attach();
      map.set(keyString, entry);
    } catch {
      /* file vanished / unwatchable — skip */
    }
  }

  return {
    setWatched(ws, sessionId, cwd, relPaths, onChange) {
      let map = byConnection.get(ws);
      if (!map) {
        map = new Map();
        byConnection.set(ws, map);
      }
      const held = map;

      // Desired keys for THIS session (other sessions on the same ws untouched).
      const desired = new Set(relPaths.map((rel) => keyOf({ sessionId, relPath: rel })));

      // Remove watchers for this session's paths that are no longer desired.
      const sessionPrefix = `${sessionId}\u0000`;
      for (const existing of [...held.keys()]) {
        if (existing.startsWith(sessionPrefix) && !desired.has(existing)) closeEntry(held, existing);
      }

      // Add watchers for newly-desired paths (synchronous, cwd-contained).
      for (const rel of relPaths) {
        const keyString = keyOf({ sessionId, relPath: rel });
        if (held.has(keyString)) continue; // already watched
        const abs = path.resolve(cwd, rel);
        if (!withinCwd(abs, cwd)) continue; // never watch outside cwd
        addWatch(held, keyString, abs, () => onChange(sessionId, rel));
      }
    },

    clearConnection(ws) {
      const map = byConnection.get(ws);
      if (!map) return;
      for (const key of [...map.keys()]) closeEntry(map, key);
      byConnection.delete(ws);
    },

    activeWatchCount() {
      let n = 0;
      for (const map of byConnection.values()) for (const e of map.values()) if (e.hasWatcher()) n++;
      return n;
    },

    pendingTimerCount() {
      let n = 0;
      for (const map of byConnection.values()) for (const e of map.values()) n += e.pendingTimers();
      return n;
    },
  };
}
