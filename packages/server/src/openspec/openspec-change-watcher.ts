/**
 * Per-cwd filesystem watchers: `<cwd>/openspec/changes/` (recursive, the
 * required one), `<cwd>/openspec/` (non-recursive, for `config.yaml`) and
 * `<cwd>/openspec/schemas/` (recursive, when it exists). Main specs under
 * `<cwd>/openspec/specs/` are NOT watched.
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
import { matchesOutputPattern } from "@blackbelt-technology/pi-dashboard-shared/openspec-status-all.js";

/**
 * Legacy filename filter for events under `changes/<change>/`:
 *   - `tasks.md`, `proposal.md`, `design.md` at the change root
 *   - any `*.md` under any `specs/` subtree
 *   - `.openspec.yaml` (change metadata — affects schema / error state)
 *   - `dependencies.yaml` (declared change dependencies; spec-driven changes do
 *     not declare it as an artifact). See change: add-openspec-change-dependencies.
 *
 * The watcher event filename is the relative path from the watch root
 * (`openspec/changes/`), so a typical match is
 * `my-change/tasks.md` or `my-change/specs/cap/spec.md`.
 *
 * Normalized to forward slashes before matching so Windows backslash paths
 * (`my-change\\tasks.md`) match too.
 */
const FILTER_RE =
  /^[^/]+\/(?:tasks\.md|proposal\.md|design\.md|\.openspec\.yaml|dependencies\.yaml|specs(?:\/.*)?\.md)$/;

/**
 * Relevant events under `openspec/changes/` (path relative to that dir):
 *   (a) creation/rename of a change dir itself (a single dot-free segment other
 *       than `archive`), or a legacy artifact name under any `<change>/`
 *       (also for change dirs not yet in the cached result);
 *   (b) under a change in the cached `status --all` result, a path matching one
 *       of that change's artifact outputs (`outputsByChange`), so a
 *       not-yet-created output such as `dependencies.yaml` matches.
 *
 * Exported for unit tests.
 */
export function matchesOpenSpecArtifact(
  relPath: string | null | undefined,
  outputsByChange?: Record<string, string[]>,
  eventType?: string,
): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, "/");
  if (FILTER_RE.test(normalized)) return true;
  const slash = normalized.indexOf("/");
  if (slash === -1) {
    // A bare dir name is a change dir being created/renamed/removed. A plain
    // `change` event on it is just its mtime moving (a file written inside),
    // which is covered by the file-level filters above.
    if (eventType !== undefined && eventType !== "rename") return false;
    return !normalized.includes(".") && normalized !== "archive";
  }
  const change = normalized.slice(0, slash);
  if (change === "archive") return false;
  const patterns = outputsByChange?.[change];
  if (!patterns) return false;
  const rest = normalized.slice(slash + 1);
  return patterns.some((pattern) => matchesOutputPattern(rest, pattern));
}

/** Relevant events on the non-recursive `openspec/` watcher: `config.yaml` and `schemas`. */
export function matchesOpenSpecRootEvent(relPath: string | null | undefined): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, "/");
  return normalized === "config.yaml" || normalized === "schemas";
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
  /**
   * Artifact output patterns (relative to the change dir, forward slashes) per
   * change from the cached `status --all` result for `cwd`. Optional.
   */
  getOutputPatterns?: (cwd: string) => Record<string, string[]> | undefined;
  /** Debounce window in ms (default 300). */
  debounceMs?: number;
  /** Optional logger; defaults to `console.warn` for failures only. */
  logger?: (msg: string) => void;
}

type WatcherEntry = {
  /** The required recursive watcher on `openspec/changes/`. */
  watcher: fs.FSWatcher;
  /** Extra watchers (`openspec/` non-recursive, `openspec/schemas/` recursive). */
  extras: Map<"root" | "schemas", fs.FSWatcher>;
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
    const entry: WatcherEntry = { watcher, extras: new Map(), debounceTimer: null };
    attached.set(cwd, entry);
    failedOnce.delete(cwd);

    const onChangesEvent = (eventType: string, filename: string | Buffer | null) => {
      // filename may be Buffer; coerce to string. Node also emits `null`
      // on some platforms when the source is renamed underneath us.
      const rel = filename ? filename.toString() : null;
      if (!matchesOpenSpecArtifact(rel, deps.getOutputPatterns?.(cwd), eventType)) return;
      scheduleFire(cwd);
    };
    // Some platforms emit `rename` instead of (or alongside) `change`.
    watcher.on("change", onChangesEvent);
    watcher.on("rename", onChangesEvent);
    watcher.on("error", (err) => {
      log(`[openspec-watcher] error on ${cwd}: ${err.message}`);
      detach(cwd);
    });

    attachExtras(cwd, entry);
    return true;
  }

  /** `openspec/` (non-recursive) and `openspec/schemas/` (recursive); best-effort. */
  function attachExtras(cwd: string, entry: WatcherEntry): void {
    const openspecDir = path.join(cwd, "openspec");
    if (!entry.extras.has("root")) {
      try {
        const w = fs.watch(openspecDir, { recursive: false, persistent: false });
        const onRoot = (_e: string, filename: string | Buffer | null) => {
          const rel = filename ? filename.toString() : null;
          if (!matchesOpenSpecRootEvent(rel)) return;
          // `schemas/` created after attach: start watching it now.
          if (rel && rel.replace(/\\/g, "/") === "schemas") attachExtras(cwd, entry);
          scheduleFire(cwd);
        };
        w.on("change", onRoot);
        w.on("rename", onRoot);
        w.on("error", () => closeExtra(entry, "root"));
        entry.extras.set("root", w);
      } catch {
        // degraded: config.yaml edits are covered by the periodic poll
      }
    }
    if (!entry.extras.has("schemas")) {
      try {
        const w = fs.watch(path.join(openspecDir, "schemas"), { recursive: true, persistent: false });
        const onSchema = () => scheduleFire(cwd);
        w.on("change", onSchema);
        w.on("rename", onSchema);
        w.on("error", () => closeExtra(entry, "schemas"));
        entry.extras.set("schemas", w);
      } catch {
        // no schemas/ yet (or EMFILE) — retried when `schemas` appears under openspec/
      }
    }
  }

  function closeExtra(entry: WatcherEntry, key: "root" | "schemas"): void {
    const w = entry.extras.get(key);
    if (!w) return;
    try {
      w.close();
    } catch {
      // best effort
    }
    entry.extras.delete(key);
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
    for (const key of Array.from(entry.extras.keys())) closeExtra(entry, key);
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
