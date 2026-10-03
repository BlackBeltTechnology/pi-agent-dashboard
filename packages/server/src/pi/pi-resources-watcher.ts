/**
 * Non-recursive `fs.watch` invalidation for the pi-resources cache (change:
 * optimize-polling-hot-paths, D9). Shape of `openspec/openspec-change-watcher.ts`.
 *
 * Per cwd: `<cwd>/.pi` + its `skills|prompts|extensions|agents|themes`
 * subdirs. One shared global set: `~/.pi/agent` + the same subdirs. Trigger
 * only — `onInvalidate(cwd)` marks a cache entry stale (`cwd === undefined` =
 * the global scope, which invalidates every entry); the scan stays on demand.
 *
 * An event invalidates when its filename is `settings.json`, any entry inside a
 * watched resource subdir, a resource-subdir NAME appearing in a `.pi` dir
 * (directory creation — also attaches the new subdir), or `null`.
 *
 * Failure mode: a throwing `fs.watch` (ENOENT/EMFILE/EACCES/EPERM) leaves that
 * dir unwatched; `attach` returns `false`; the 5-minute staleness bound in the
 * directory service still covers the entry.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PI_RESOURCE_SUBDIRS = ["skills", "prompts", "extensions", "agents", "themes"] as const;

export type PiWatchFn = (
  dir: string,
  opts: { persistent: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => Pick<fs.FSWatcher, "close" | "on">;

export interface PiResourcesWatcherDeps {
  /** `cwd` undefined = the global scope changed. */
  onInvalidate: (cwd: string | undefined) => void;
  watch?: PiWatchFn;
  /** Override `~` (tests). */
  homeDir?: string;
  isDir?: (p: string) => boolean;
  /** Identity of a directory (inode); a recreated dir at the same path differs. */
  inodeOf?: (p: string) => number;
}

export interface PiResourcesWatcher {
  /** Attach `<cwd>/.pi` + existing resource subdirs. True iff something was newly attached. */
  attach(cwd: string): boolean;
  /** Attach subdirs that exist now but were missing before. */
  reconcile(cwd: string): void;
  has(cwd: string): boolean;
  detach(cwd: string): void;
  attachGlobal(): boolean;
  hasGlobal(): boolean;
  detachAll(): void;
  /** Number of cwds with at least one live watch (global excluded). */
  size(): number;
}

const GLOBAL = "\0global";

export function createPiResourcesWatcher(deps: PiResourcesWatcherDeps): PiResourcesWatcher {
  const watch: PiWatchFn = deps.watch ?? ((dir, opts, listener) => fs.watch(dir, opts, listener));
  const isDir =
    deps.isDir ??
    ((p: string) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  const inodeOf =
    deps.inodeOf ??
    ((p: string) => {
      try {
        return fs.statSync(p).ino;
      } catch {
        return 0;
      }
    });
  const home = () => deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();

  /** scope key → (dir → watcher + the inode it was attached to) */
  const scopes = new Map<string, Map<string, { w: Pick<fs.FSWatcher, "close" | "on">; ino: number }>>();

  const baseOf = (key: string): string =>
    key === GLOBAL ? path.join(home(), ".pi", "agent") : path.join(key, ".pi");
  const targetOf = (key: string): string | undefined => (key === GLOBAL ? undefined : key);

  /** Filename rules; see the file header. `null` filename = unknown event. */
  function onFsEvent(key: string, isBase: boolean, name: string | null): void {
    if (name === null) {
      deps.onInvalidate(targetOf(key));
      reconcileScope(key);
    } else if (!isBase) {
      deps.onInvalidate(targetOf(key));
    } else if (name === "settings.json") {
      deps.onInvalidate(targetOf(key));
    } else if ((PI_RESOURCE_SUBDIRS as readonly string[]).includes(name)) {
      deps.onInvalidate(targetOf(key));
      reconcileScope(key); // a newly created subdir becomes watched
    }
  }

  function attachDir(key: string, dir: string, isBase: boolean): boolean {
    let dirs = scopes.get(key);
    if (dirs?.has(dir)) return false;
    let w: Pick<fs.FSWatcher, "close" | "on">;
    try {
      w = watch(dir, { persistent: false }, (_event, filename) => {
        onFsEvent(key, isBase, filename === null ? null : filename.toString());
      });
    } catch {
      return false;
    }
    w.on("error", () => {
      /* a dead watcher never throws; staleness bound covers the entry */
    });
    if (!dirs) {
      dirs = new Map();
      scopes.set(key, dirs);
    }
    dirs.set(dir, { w, ino: inodeOf(dir) });
    return true;
  }

  function closeDir(key: string, dir: string): void {
    const entry = scopes.get(key)?.get(dir);
    if (!entry) return;
    try {
      entry.w.close();
    } catch {
      /* already closed */
    }
    scopes.get(key)?.delete(dir);
  }

  /**
   * Attach what exists, drop what vanished, and RE-attach a directory that was
   * removed and recreated: `fs.watch` stays bound to the old inode, so without
   * the identity check a recreated `skills/` would never invalidate again.
   */
  function reconcileScope(key: string): boolean {
    const base = baseOf(key);
    let attached = syncDir(key, base, true);
    for (const sub of PI_RESOURCE_SUBDIRS) attached = syncDir(key, path.join(base, sub), false) || attached;
    return attached;
  }

  /** Bring one directory's watch in line with the filesystem. True iff newly attached. */
  function syncDir(key: string, dir: string, isBase: boolean): boolean {
    const existing = scopes.get(key)?.get(dir);
    if (!isDir(dir)) {
      if (existing) closeDir(key, dir);
      return false;
    }
    if (existing && existing.ino === inodeOf(dir)) return false;
    if (existing) closeDir(key, dir);
    return attachDir(key, dir, isBase);
  }

  function detachScope(key: string): void {
    const dirs = scopes.get(key);
    if (!dirs) return;
    for (const { w } of dirs.values()) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    scopes.delete(key);
  }

  return {
    attach: (cwd) => reconcileScope(cwd),
    reconcile: (cwd) => void reconcileScope(cwd),
    has: (cwd) => scopes.has(cwd),
    detach: detachScope,
    attachGlobal: () => reconcileScope(GLOBAL),
    hasGlobal: () => scopes.has(GLOBAL),
    detachAll() {
      for (const key of [...scopes.keys()]) detachScope(key);
    },
    size: () => [...scopes.keys()].filter((k) => k !== GLOBAL).length,
  };
}
