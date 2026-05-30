/**
 * Per-cwd filesystem watcher on `<cwd>/openspec/changes/` (recursive).
 *
 * Trigger-only: invokes `onChange(cwd)` so callers (DirectoryService) fan the
 * event into the existing mtime-gated poll. The watcher does NOT bypass the
 * mtime-gate, the concurrency semaphore, or the broadcast dedup — it is a
 * faster trigger for the periodic poll, not a parallel poll path.
 *
 * Failure mode: if `fs.watch(...)` throws (ENOENT for missing
 * `openspec/changes/`, EMFILE, EACCES, EPERM), the watcher silently
 * degrades to "not attached" for that cwd. The periodic poll still
 * guarantees correctness — just at the slower cadence.
 *
 * See change: fix-openspec-taskcheck-delay.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Filename filter for watcher events. Matches the artifact set whose edits
 * actually affect openspec output:
 *   - `tasks.md`, `proposal.md`, `design.md` at the change root
 *   - any `*.md` under any `specs/` subtree
 *
 * The watcher event filename is the relative path from the watch root
 * (`openspec/changes/`), so a typical match is
 * `my-change/tasks.md` or `my-change/specs/cap/spec.md`.
 *
 * Normalized to forward slashes before matching so Windows backslash paths
 * (`my-change\\tasks.md`) match too.
 */
const FILTER_RE =
  /^[^/]+\/(?:tasks\.md|proposal\.md|design\.md|specs(?:\/.*)?\.md)$/;

/** Exported for unit tests. */
export function matchesOpenSpecArtifact(relPath: string | null | undefined): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, "/");
  return FILTER_RE.test(normalized);
}

export interface OpenSpecChangeWatcher {
  /**
   * Attach watcher to `<cwd>/openspec/changes/`.
   * Returns `true` iff a watcher was newly attached. Returns `false` when
   * already attached OR when `fs.watch(...)` failed (ENOENT/EMFILE/etc.).
   * Callers should treat `false` as "retry later" — do NOT mark this cwd
   * as permanently attached.
   * See change: fix-openspec-taskcheck-delay.
   */
  attach(cwd: string): boolean;
  /** Detach watcher + clear pending debounce timer. Idempotent. */
  detach(cwd: string): void;
  /** Detach every attached cwd. */
  detachAll(): void;
  /** Test helper: number of currently-attached cwds. */
  size(): number;
}

export interface OpenSpecChangeWatcherDeps {
  /** Called after the debounce window for a cwd whose events matched the filter. */
  onChange: (cwd: string) => void;
  /** Debounce window in ms (default 300). */
  debounceMs?: number;
  /** Optional logger; defaults to `console.warn` for failures only. */
  logger?: (msg: string) => void;
}

type WatcherEntry = {
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

export function createOpenSpecChangeWatcher(
  deps: OpenSpecChangeWatcherDeps,
): OpenSpecChangeWatcher {
  const debounceMs = deps.debounceMs ?? 300;
  const log = deps.logger ?? ((msg: string) => console.warn(msg));
  const attached = new Map<string, WatcherEntry>();
  // Track cwds where attach failed so we don't spam logs on repeated attach calls.
  const failedOnce = new Set<string>();

  function scheduleFire(cwd: string) {
    const entry = attached.get(cwd);
    if (!entry) return; // detached during burst
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      const current = attached.get(cwd);
      if (!current) return; // post-detach race
      current.debounceTimer = null;
      try {
        deps.onChange(cwd);
      } catch (err) {
        log(`[openspec-watcher] onChange threw for ${cwd}: ${(err as Error).message}`);
      }
    }, debounceMs);
  }

  function attach(cwd: string): boolean {
    if (attached.has(cwd)) return false;
    const watchRoot = path.join(cwd, "openspec", "changes");
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(watchRoot, { recursive: true, persistent: false });
    } catch (err) {
      if (!failedOnce.has(cwd)) {
        failedOnce.add(cwd);
        const code = (err as NodeJS.ErrnoException).code ?? "ERR";
        log(`[openspec-watcher] attach failed for ${cwd} (${code}); periodic poll will cover this cwd`);
      }
      return false;
    }
    const entry: WatcherEntry = { watcher, debounceTimer: null };
    attached.set(cwd, entry);
    failedOnce.delete(cwd);

    watcher.on("change", (_eventType, filename) => {
      // filename may be Buffer; coerce to string. Node also emits `null`
      // on some platforms when the source is renamed underneath us.
      const rel = filename ? filename.toString() : null;
      if (!matchesOpenSpecArtifact(rel)) return;
      scheduleFire(cwd);
    });
    // Some platforms emit `rename` instead of (or alongside) `change`.
    watcher.on("rename", (_eventType, filename) => {
      const rel = filename ? filename.toString() : null;
      if (!matchesOpenSpecArtifact(rel)) return;
      scheduleFire(cwd);
    });
    watcher.on("error", (err) => {
      log(`[openspec-watcher] error on ${cwd}: ${err.message}`);
      detach(cwd);
    });
    return true;
  }

  function detach(cwd: string): void {
    const entry = attached.get(cwd);
    if (!entry) return;
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    try {
      entry.watcher.close();
    } catch {
      // close() is best-effort; ignore errors.
    }
    attached.delete(cwd);
  }

  function detachAll(): void {
    for (const cwd of Array.from(attached.keys())) detach(cwd);
  }

  function size(): number {
    return attached.size;
  }

  return { attach, detach, detachAll, size };
}
