/**
 * Per-scope filesystem watcher on `<scopeBase>/.pi/automation/` (recursive).
 *
 * Trigger-only: invokes `onChange(scopeBase)` (debounced 300 ms) so the
 * caller re-scans both scopes and re-arms the scheduler. Cloned from
 * `openspec-change-watcher.ts` (same degrade-on-failure semantics: an
 * `fs.watch` throw silently degrades to "not attached" — a periodic re-scan,
 * if any, still covers correctness).
 *
 * Filters to events whose filename matches `<name>/automation.yaml` or
 * `<name>/prompt.md` so unrelated writes under the run store don't churn the
 * scheduler.
 *
 * See change: add-automation-plugin.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Matches `<name>/automation.yaml` or `<name>/prompt.md` (forward-slashed). */
const FILTER_RE = /^[^/]+\/(?:automation\.yaml|prompt\.md)$/;

/** Exported for unit tests. */
export function matchesAutomationArtifact(relPath: string | null | undefined): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, "/");
  return FILTER_RE.test(normalized);
}

export interface AutomationWatcher {
  /**
   * Attach watcher to `<scopeBase>/.pi/automation/`. Returns `true` iff newly
   * attached; `false` when already attached OR when `fs.watch` failed.
   */
  attach(scopeBase: string): boolean;
  detach(scopeBase: string): void;
  detachAll(): void;
  size(): number;
}

export interface AutomationWatcherDeps {
  onChange: (scopeBase: string) => void;
  debounceMs?: number;
  logger?: (msg: string) => void;
}

type WatcherEntry = {
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

export function createAutomationWatcher(deps: AutomationWatcherDeps): AutomationWatcher {
  const debounceMs = deps.debounceMs ?? 300;
  const log = deps.logger ?? ((msg: string) => console.warn(msg));
  const attached = new Map<string, WatcherEntry>();
  const failedOnce = new Set<string>();

  function scheduleFire(scopeBase: string) {
    const entry = attached.get(scopeBase);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      const current = attached.get(scopeBase);
      if (!current) return;
      current.debounceTimer = null;
      try {
        deps.onChange(scopeBase);
      } catch (err) {
        log(`[automation-watcher] onChange threw for ${scopeBase}: ${(err as Error).message}`);
      }
    }, debounceMs);
  }

  function attach(scopeBase: string): boolean {
    if (attached.has(scopeBase)) return false;
    const watchRoot = path.join(scopeBase, ".pi", "automation");
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(watchRoot, { recursive: true, persistent: false });
    } catch (err) {
      if (!failedOnce.has(scopeBase)) {
        failedOnce.add(scopeBase);
        const code = (err as NodeJS.ErrnoException).code ?? "ERR";
        log(`[automation-watcher] attach failed for ${scopeBase} (${code})`);
      }
      return false;
    }
    const entry: WatcherEntry = { watcher, debounceTimer: null };
    attached.set(scopeBase, entry);
    failedOnce.delete(scopeBase);

    const onEvent = (_eventType: string, filename: string | Buffer | null) => {
      const rel = filename ? filename.toString() : null;
      if (!matchesAutomationArtifact(rel)) return;
      scheduleFire(scopeBase);
    };
    watcher.on("change", onEvent);
    watcher.on("rename", onEvent);
    watcher.on("error", (err) => {
      log(`[automation-watcher] error on ${scopeBase}: ${err.message}`);
      detach(scopeBase);
    });
    return true;
  }

  function detach(scopeBase: string): void {
    const entry = attached.get(scopeBase);
    if (!entry) return;
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    try {
      entry.watcher.close();
    } catch {
      /* best-effort */
    }
    attached.delete(scopeBase);
  }

  function detachAll(): void {
    for (const scopeBase of Array.from(attached.keys())) detach(scopeBase);
  }

  function size(): number {
    return attached.size;
  }

  return { attach, detach, detachAll, size };
}
