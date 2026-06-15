/**
 * DirectoryService — server-side directory-scoped operations.
 *
 * Responsibilities:
 *   - Session discovery and event loading (unchanged).
 *   - OpenSpec polling with an mtime-gated cache, configurable interval,
 *     concurrency cap (semaphore), and deterministic per-cwd jitter to
 *     flatten the CPU envelope.
 *   - Pi resources scanning on its own slower cadence (5× openspec interval)
 *     so it does not stack onto the openspec burst.
 *
 * See change: optimize-openspec-poll-burst for the cost model.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildOpenSpecData,
  deriveArtifactStatus,
  pollOpenSpecAsync,
  runOpenSpecList,
  runOpenSpecStatus,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import { DEFAULT_OPENSPEC_POLL, type OpenSpecPollConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { createSemaphore, type Semaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";
import { createOpenSpecChangeWatcher, type OpenSpecChangeWatcher } from "./openspec-change-watcher.js";
import { discoverSessionsForCwd } from "./session-discovery.js";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { scanPiResources } from "./pi-resource-scanner.js";
import type { OpenSpecData, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { PreferencesStore } from "./preferences-store.js";
import type { SessionManager } from "./memory-session-manager.js";

import type { DiscoveredSession } from "./session-discovery.js";
export type { DiscoveredSession } from "./session-discovery.js";

export interface LoadResult {
  success: boolean;
  events: Array<{ eventType: string; timestamp: number; data: Record<string, unknown> }>;
  error?: string;
}

export interface DirectoryAddedResult {
  sessions: DiscoveredSession[];
  openspecData: OpenSpecData;
}

/**
 * `true` if `OpenSpecData` represents "no useful data yet" — either
 * absent, or `{ initialized: false, changes: [] }` (cold cache).
 * Used by broadcast call-sites to decide whether a transition from
 * empty→populated warrants firing `openspec_update`. Pulled into
 * shared scope so `server.ts` (post-install repair) and
 * `session-bootstrap.ts` (initial poll) both use the same predicate.
 *
 * See change: fix-cold-boot-openspec-protocol.
 */
export function isOpenSpecDataEmpty(d: OpenSpecData | undefined): boolean {
  if (!d) return true;
  return !d.initialized && (!d.changes || d.changes.length === 0);
}

/**
 * Synchronous, spawn-free probe for `<cwd>/openspec/changes`. Returns
 * `true` iff the path exists and is a directory. Used by the WS
 * on-connect snapshot to disambiguate "no openspec here" from
 * "openspec here, polling pending". ~10 μs per call.
 *
 * See change: fix-cold-boot-openspec-protocol.
 */
export function hasOpenSpecDir(cwd: string): boolean {
  try {
    return fs.statSync(path.join(cwd, "openspec", "changes")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `true` iff `<cwd>/openspec/` exists and is a directory. Strictly weaker than
 * `hasOpenSpecDir` (which also requires the `changes/` subdir). Used by the
 * WS on-connect snapshot to emit the new `hasOpenspecDir` field on every
 * payload so freshly-initialized projects without `changes/` yet still surface
 * the OPENSPEC subcard as an init/attach affordance on the client.
 *
 * See change: auto-hide-empty-session-subcards.
 */
export function hasOpenSpecRoot(cwd: string): boolean {
  try {
    return fs.statSync(path.join(cwd, "openspec")).isDirectory();
  } catch {
    return false;
  }
}

export interface DirectoryService {
  knownDirectories(): string[];
  discoverSessions(cwd: string): DiscoveredSession[];
  loadSessionEvents(sessionId: string, sessionFile: string, knownContextWindow?: number): Promise<LoadResult>;
  getOpenSpecData(cwd: string): OpenSpecData | undefined;
  /** Force refresh: bypasses the mtime gate. Still honors the semaphore. */
  refreshOpenSpec(cwd: string): Promise<OpenSpecData>;
  /** Gated poll: respects `changeDetection` config and the semaphore. Returns cached data. */
  pollDirectoryGated(cwd: string): Promise<OpenSpecData>;
  getPiResources(cwd: string): PiResourcesResult | undefined;
  refreshPiResources(cwd: string): Promise<PiResourcesResult>;
  startPolling(onChange: (cwd: string, data: OpenSpecData) => void): void;
  stopPolling(): void;
  /** Apply a new OpenSpecPollConfig without losing cache. Safe to call mid-stream. */
  reconfigurePolling(config: OpenSpecPollConfig): void;
  onDirectoryAdded(cwd: string): Promise<DirectoryAddedResult>;
}

// ── Jitter ─────────────────────────────────────────────────────────
// 32-bit FNV-1a hash — cheap, stable, well-distributed for short strings.
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function phaseOffsetMs(cwd: string, jitterSeconds: number): number {
  if (!Number.isFinite(jitterSeconds) || jitterSeconds <= 0) return 0;
  return fnv1a32(cwd) % (jitterSeconds * 1000);
}

// ── mtime helpers ──────────────────────────────────────────────────
function statMtimeOr(p: string): number | undefined {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * Maximum mtime across a fixed list of paths. Missing paths (ENOENT) are
 * skipped — they don't poison the result. Returns `undefined` only when
 * every input is missing.
 *
 * Used by the change-detection gate to catch in-place file edits that
 * don't bump any parent directory's mtime on POSIX. See change:
 * fix-openspec-mtime-gate-blind-spots.
 */
export function effectiveMtimeOr(paths: string[]): number | undefined {
  let max: number | undefined;
  for (const p of paths) {
    const m = statMtimeOr(p);
    if (m === undefined) continue;
    if (max === undefined || m > max) max = m;
  }
  return max;
}

/**
 * File set tracked by the per-change effective-mtime computation.
 *
 * The base set covers the change directory itself plus the three top-level
 * artifact files. The `specs/` fan-out catches multi-spec authoring:
 *
 *   - `<change>/specs/`               — advances on capability dir create/remove
 *   - `<change>/specs/<cap>/`         — advances when `spec.md` is created inside
 *   - `<change>/specs/<cap>/spec.md`  — advances on in-place edits
 *
 * `readdirSync` is wrapped in try/catch so missing `specs/` (or any fs error)
 * yields an empty fan-out rather than throwing.
 *
 * See change: fix-openspec-specs-mtime-gate-blind-spot.
 */
function perChangeArtifactPaths(changesRoot: string, name: string): string[] {
  const dir = path.join(changesRoot, name);
  const base = [
    dir,
    path.join(dir, "tasks.md"),
    path.join(dir, "proposal.md"),
    path.join(dir, "design.md"),
  ];
  const specsDir = path.join(dir, "specs");
  const specsExtras: string[] = [specsDir];
  try {
    const entries = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const capDir = path.join(specsDir, e.name);
        specsExtras.push(capDir);
        specsExtras.push(path.join(capDir, "spec.md"));
      }
    }
  } catch {
    // ENOENT, permission denied, etc. — leave specsExtras with just specsDir
    // (its own statMtimeOr will return undefined and be excluded from max).
  }
  return [...base, ...specsExtras];
}

// ── Per-directory cache ────────────────────────────────────────────
type PerChangeEntry = {
  mtimeMs: number | undefined;
  change: OpenSpecChange;
};

type DirCache = {
  /** mtime of `<cwd>/openspec/changes/` when we last ran `openspec list`. */
  listMtimeMs: number | undefined;
  /** Cached list-result entries (raw shape from openspec list). */
  listResult: Array<{ name: string; status: string; completedTasks: number; totalTasks: number }> | undefined;
  changes: Map<string, PerChangeEntry>;
  /** Last built OpenSpecData (what we broadcast). */
  data: OpenSpecData | undefined;
};

function emptyDirCache(): DirCache {
  return { listMtimeMs: undefined, listResult: undefined, changes: new Map(), data: undefined };
}

export interface DirectoryServiceOptions {
  /**
   * Optional async post-processor applied to `OpenSpecData` after
   * `buildOpenSpecData` and before caching. Used to inject the per-cwd
   * `groupId` join from the OpenSpec change-grouping store.
   * Errors propagate as a logged warning + the unenriched data.
   * See change: add-openspec-change-grouping.
   */
  enrichOpenSpecData?: (cwd: string, data: OpenSpecData) => Promise<OpenSpecData> | OpenSpecData;
  /**
   * Optional override for the per-cwd OpenSpec change watcher. When omitted,
   * a real `fs.watch`-backed watcher is constructed. Tests may inject a
   * stub to avoid touching the real filesystem.
   * See change: fix-openspec-taskcheck-delay.
   */
  changeWatcher?: OpenSpecChangeWatcher;
}

export function createDirectoryService(
  preferencesStore: PreferencesStore,
  sessionManager: SessionManager,
  initialConfig?: Partial<OpenSpecPollConfig>,
  options: DirectoryServiceOptions = {},
): DirectoryService {
  let cfg: OpenSpecPollConfig = { ...DEFAULT_OPENSPEC_POLL, ...(initialConfig ?? {}) };
  const enrichOpenSpecData = options.enrichOpenSpecData;

  // Per-cwd `fs.watch` on `openspec/changes/`. On a relevant file event
  // (debounced 300 ms) fans into `pollOne(cwd, false)` so the existing
  // mtime-gate + semaphore + broadcast dedup do their job. Periodic poll
  // remains as the fallback for missed events (network FS, EMFILE, etc.).
  // See change: fix-openspec-taskcheck-delay.
  const changeWatcher: OpenSpecChangeWatcher = options.changeWatcher ?? createOpenSpecChangeWatcher({
    onChange: (cwd) => { void onWatcherFired(cwd); },
  });
  const attachedWatcherCwds = new Set<string>();

  const caches = new Map<string, DirCache>();
  const piResourcesCache = new Map<string, PiResourcesResult>();

  let semaphore: Semaphore = createSemaphore(cfg.maxConcurrentSpawns);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let piResourcesTimer: ReturnType<typeof setInterval> | null = null;
  let onChangeCallback: ((cwd: string, data: OpenSpecData) => void) | null = null;
  const scheduledPhaseTimers = new Set<ReturnType<typeof setTimeout>>();
  // cwds for which the current poll cycle broadcast a transitional
  // `pending:true` that the diff-guarded wrappers must still clear, even when
  // the final payload's JSON equals the prior cache (e.g. a second
  // back-to-back empty/failed poll). Without this the spinner would stay stuck
  // after the pending emit. See change: emit-openspec-pending-from-poll.
  const pendingEmittedCwds = new Set<string>();

  // In-progress session loads for dedup
  const loadingSet = new Set<string>();

  function computeKnownDirectories(): string[] {
    const dirs = new Set<string>();
    for (const dir of preferencesStore.getPinnedDirectories()) dirs.add(dir);
    // Only non-ended sessions contribute their cwd to the work set. Pinning
    // remains an explicit "watch this" signal independent of session state
    // and is handled above. See change: scope-openspec-poll-to-active-cwds.
    for (const session of sessionManager.listAll()) {
      if (session.status !== "ended") dirs.add(session.cwd);
    }
    return Array.from(dirs);
  }

  function discoverSessions(cwd: string): DiscoveredSession[] {
    return discoverSessionsForCwd(cwd);
  }

  async function loadSessionEvents(sessionId: string, sessionFile: string, knownContextWindow?: number): Promise<LoadResult> {
    if (loadingSet.has(sessionId)) {
      return { success: false, events: [], error: "already_loading" };
    }
    loadingSet.add(sessionId);
    try {
      const { loadSessionEntries } = await import("./session-file-reader.js");
      const entries = loadSessionEntries(sessionFile);
      // Pass persisted contextWindow so replay's stats_update events use the
      // real value instead of inferContextWindow(modelId)'s 200k Claude default.
      const eventMessages = replayEntriesAsEvents(sessionId, entries, knownContextWindow);
      const events = eventMessages.map((m) => m.event);
      return { success: true, events };
    } catch (err: any) {
      const error = err?.code === "ENOENT" ? "file_not_found" : (err?.message ?? "parse_error");
      return { success: false, events: [], error };
    } finally {
      loadingSet.delete(sessionId);
    }
  }

  // ── Core gated poll ──────────────────────────────────────────────
  // Contract:
  //   - `force=true` bypasses both the list-mtime and per-change-mtime gates.
  //   - Every CLI spawn goes through the shared semaphore.
  //   - Cache is updated atomically per directory: on any failure the
  //     old cache stays intact.
  async function pollOne(cwd: string, force: boolean): Promise<OpenSpecData> {
    const cache = caches.get(cwd) ?? emptyDirCache();
    const gateEnabled = cfg.changeDetection === "mtime" && !force;

    const openspecRoot = path.join(cwd, "openspec");
    const changesRoot = path.join(cwd, "openspec", "changes");
    // `hasOpenspecDir` is strictly weaker than `initialized`: it's true when
    // the project is OpenSpec-initialized (`openspec/` dir exists) even if no
    // proposals are authored yet (no `openspec/changes/` subdir). The session
    // card visibility gate uses this signal so a fresh `openspec init` project
    // still shows the OPENSPEC subcard as an init/attach affordance.
    // See change: auto-hide-empty-session-subcards.
    const hasOpenspecDir = statMtimeOr(openspecRoot) !== undefined;
    const rootMtime = statMtimeOr(changesRoot);

    // If the changes/ subdirectory doesn't exist, short-circuit (matches old
    // behavior re: list polling). `hasOpenspecDir` still carries the broader
    // "is this an OpenSpec project?" signal for the client.
    if (rootMtime === undefined) {
      const empty: OpenSpecData = { initialized: false, changes: [], hasOpenspecDir };
      cache.data = empty;
      cache.listMtimeMs = undefined;
      cache.listResult = undefined;
      cache.changes.clear();
      caches.set(cwd, cache);
      return empty;
    }

    // ── Step 1: list (gated) ──
    //
    // The list-step gate signal must catch in-place edits to <change>/tasks.md
    // because `completedTasks` / `totalTasks` are derived from those files. POSIX
    // dir-mtime alone misses these edits (it only advances on entry create/
    // delete/rename), so we union the parent-dir mtime with each known
    // tasks.md file's mtime. See change: fix-openspec-mtime-gate-blind-spots.
    let listResult: typeof cache.listResult = cache.listResult;
    let listSignal: number | undefined = rootMtime;
    if (cache.listResult !== undefined) {
      const taskFiles = cache.listResult.map((c) =>
        path.join(changesRoot, c.name, "tasks.md"),
      );
      listSignal = effectiveMtimeOr([changesRoot, ...taskFiles]) ?? rootMtime;
    }
    const listCacheValid = gateEnabled && cache.listMtimeMs === listSignal && cache.listResult !== undefined;
    if (!listCacheValid) {
      const raw = await semaphore.run(() => runOpenSpecList(cwd));
      if (!raw || !Array.isArray(raw.changes)) {
        const empty: OpenSpecData = { initialized: false, changes: [], hasOpenspecDir };
        cache.data = empty;
        cache.listMtimeMs = rootMtime;
        cache.listResult = undefined;
        cache.changes.clear();
        caches.set(cwd, cache);
        return empty;
      }
      listResult = raw.changes;
      // Recompute the signal against the freshly returned change set so the
      // cache stamps the same shape we'll compare against on the next tick.
      const taskFiles = (listResult ?? []).map((c) =>
        path.join(changesRoot, c.name, "tasks.md"),
      );
      cache.listMtimeMs = effectiveMtimeOr([changesRoot, ...taskFiles]) ?? rootMtime;
      cache.listResult = listResult;
    }

    // Prune cache for changes no longer present.
    const liveNames = new Set((listResult ?? []).map((c) => c.name));
    for (const key of Array.from(cache.changes.keys())) {
      if (!liveNames.has(key)) cache.changes.delete(key);
    }

    // ── Step 2: per-change status (gated) ──
    //
    // TOCTOU note: we capture the file-aware effective mtime BEFORE invoking
    // `openspec status` and stamp THAT value into the cache. If a tracked
    // artifact file is written during the CLI invocation, the post-call mtime
    // will differ from `preCallMtime` and we discard this tick's status for
    // that change — leaving the prior cache entry (if any) untouched so the
    // next gated tick re-polls naturally. See change:
    // fix-openspec-mtime-gate-toctou.
    const statusResults = new Map<string, { artifacts?: Array<{ id: string; status: string }>; isComplete?: boolean } | null>();
    const preCallMtimes = new Map<string, number | undefined>();
    const racyNames = new Set<string>();

    // Per-change evidence probes for the local-derivation path (force === false).
    // See change: optimize-openspec-poll-derive-artifacts-locally.
    const designFactory = createFsProbeFactory(cwd);
    const specsFactory = createFsSpecsProbeFactory(cwd);

    await Promise.all((listResult ?? []).map(async (c) => {
      // File-aware effective mtime: catches in-place edits to tasks.md /
      // proposal.md / design.md that POSIX dir-mtime misses. See change:
      // fix-openspec-mtime-gate-blind-spots.
      const preCallMtime = effectiveMtimeOr(perChangeArtifactPaths(changesRoot, c.name));
      preCallMtimes.set(c.name, preCallMtime);
      const cached = cache.changes.get(c.name);

      if (gateEnabled && cached && cached.mtimeMs !== undefined && cached.mtimeMs === preCallMtime) {
        // Cache hit. Reuse the artifacts/isComplete from the cached OpenSpecChange.
        statusResults.set(c.name, {
          artifacts: cached.change.artifacts.map((a) => ({ id: a.id, status: a.status })),
          ...(cached.change.isComplete !== undefined ? { isComplete: cached.change.isComplete } : {}),
        });
        return;
      }

      // Periodic / gated path (force === false): derive per-artifact status
      // from local files instead of spawning `openspec status` per change (the
      // spawn storm). Force-refresh (force === true) keeps the authoritative
      // CLI spawn. The TOCTOU mtime gate below is unchanged — derivation reads
      // the same files the gate stats. See change:
      // optimize-openspec-poll-derive-artifacts-locally.
      const status = force
        ? await semaphore.run(() => runOpenSpecStatus(cwd, c.name))
        : deriveArtifactStatus(path.join(changesRoot, c.name), c, {
            design: designFactory(c.name),
            specs: specsFactory(c.name),
          });

      // TOCTOU check. If any tracked artifact path was written between the
      // pre-call stat and now, the CLI's view of disk is stale relative to
      // the mtime we'd stamp — discard. See change: fix-openspec-mtime-gate-toctou.
      const postCallMtime = effectiveMtimeOr(perChangeArtifactPaths(changesRoot, c.name));
      if (preCallMtime !== postCallMtime) {
        if (typeof process !== "undefined" && /pi-dashboard|openspec-poll/.test(process.env?.DEBUG ?? "")) {
          // eslint-disable-next-line no-console
          console.warn(
            `[fix-openspec-mtime-gate-toctou] discarded racy status for ${c.name} (pre=${preCallMtime} post=${postCallMtime})`,
          );
        }
        racyNames.add(c.name);
        if (cached) {
          // Reuse the prior cached status so buildOpenSpecData doesn't render
          // an empty artifact list for this tick. Cache entry is preserved
          // unchanged below by skipping the stamping loop for racy names.
          statusResults.set(c.name, {
            artifacts: cached.change.artifacts.map((a) => ({ id: a.id, status: a.status })),
            ...(cached.change.isComplete !== undefined ? { isComplete: cached.change.isComplete } : {}),
          });
        }
        return;
      }
      statusResults.set(c.name, status);
    }));

    // ── Step 3: build + cache + return ──
    let data = buildOpenSpecData(
      { changes: listResult ?? [] },
      statusResults,
      createFsProbeFactory(cwd),
      createFsSpecsProbeFactory(cwd),
    );
    // `hasOpenspecDir` is true here by definition: we only reach Step 3 when
    // `<cwd>/openspec/changes/` exists, which implies `<cwd>/openspec/` exists.
    // See change: auto-hide-empty-session-subcards.
    data = { ...data, hasOpenspecDir };
    if (enrichOpenSpecData) {
      try {
        data = await enrichOpenSpecData(cwd, data);
      } catch (err) {
        // Don\'t fail the whole poll if the enricher (e.g. group-store read)
        // throws — log and continue with the unenriched data. See change:
        // add-openspec-change-grouping.
        // eslint-disable-next-line no-console
        if (typeof process !== "undefined" && /pi-dashboard|openspec-poll/.test(process.env?.DEBUG ?? "")) {
          // eslint-disable-next-line no-console
          console.warn(`[directory-service] enrichOpenSpecData(${cwd}) threw:`, err);
        }
      }
    }

    // Stamp the cache with the pre-call mtime — i.e. the mtime that
    // demonstrably reflects the file state observed by the CLI. Skip racy
    // names so the next gated tick re-polls. See change:
    // fix-openspec-mtime-gate-toctou.
    for (const change of data.changes) {
      if (racyNames.has(change.name)) continue;
      const stampMtime = preCallMtimes.has(change.name)
        ? preCallMtimes.get(change.name)
        : effectiveMtimeOr(perChangeArtifactPaths(changesRoot, change.name));
      cache.changes.set(change.name, { mtimeMs: stampMtime, change });
    }
    cache.data = data;
    caches.set(cwd, cache);
    return data;
  }

  async function refreshOpenSpec(cwd: string): Promise<OpenSpecData> {
    // Master gate: when `openspec.enabled` is false, every refresh path is a
    // no-op. Return the cleared-state shape so callers (including
    // `openspec_refresh` browser handler) converge to the disabled UX.
    // See change: auto-hide-empty-session-subcards.
    if (cfg.enabled === false) {
      // Disabled state: `hasOpenspecDir: false` ensures the client wrapper
      // hides the OPENSPEC subcard for every cwd. See change:
      // auto-hide-empty-session-subcards.
      const cleared: OpenSpecData = { initialized: false, pending: false, changes: [], hasOpenspecDir: false };
      const cache = caches.get(cwd) ?? emptyDirCache();
      cache.data = cleared;
      caches.set(cwd, cache);
      return cleared;
    }
    try {
      // User-initiated refresh bypasses the gate. The gate is heuristic; the
      // CLI is authoritative. When the user clicks the OpenSpec refresh icon
      // they expect fresh data, never silently-cached data — force-mode is
      // the user's escape hatch when the gate's heuristic is wrong, while
      // periodic paths (`pollDirectoryGated`, `onDirectoryAdded`,
      // `handleOpenSpecBulkArchive` post-archive refresh) stay gated.
      // See changes: fix-openspec-mtime-gate-toctou (re-introduced force=true),
      // fix-openspec-mtime-gate-blind-spots (initial removal of force=true).
      return await pollOne(cwd, true);
    } catch {
      // Fall back to the legacy monolithic path so "refresh" never silently fails.
      const data = await pollOpenSpecAsync(cwd);
      const cache = caches.get(cwd) ?? emptyDirCache();
      cache.data = data;
      caches.set(cwd, cache);
      return data;
    }
  }

  /**
   * Called from `OpenSpecChangeWatcher` when a relevant artifact under
   * `<cwd>/openspec/changes/` is touched. Runs the gated poll and (when the
   * resulting data differs from the cached snapshot) invokes the broadcast
   * callback installed by `startPolling`. Errors are swallowed — the next
   * periodic tick covers correctness.
   * See change: fix-openspec-taskcheck-delay.
   */
  async function onWatcherFired(cwd: string): Promise<void> {
    if (cfg.enabled === false) return;
    try {
      const prev = caches.get(cwd)?.data;
      const prevJson = prev ? JSON.stringify(prev) : undefined;
      const next = await pollDirectoryGated(cwd);
      const nextJson = JSON.stringify(next);
      // Force the broadcast when a transitional pending was emitted this cycle,
      // so the terminal clear always reaches the spinner even if the final
      // JSON matches the prior cache. See change: emit-openspec-pending-from-poll.
      const pendingWasEmitted = pendingEmittedCwds.delete(cwd);
      if (nextJson !== prevJson || pendingWasEmitted) onChangeCallback?.(cwd, next);
    } catch (err) {
      console.error(`[openspec-watcher] poll failed for ${cwd}:`, err);
    }
  }

  /**
   * Ensure `changeWatcher` is attached to every currently-known cwd and
   * detached from every cwd that is no longer known. Cheap (set diff over
   * typically < 10 cwds); called at the start of each periodic tick and
   * from `onDirectoryAdded`.
   * See change: fix-openspec-taskcheck-delay.
   */
  function reconcileWatchers(): void {
    const known = new Set(computeKnownDirectories());
    for (const cwd of known) {
      if (!attachedWatcherCwds.has(cwd)) {
        // Only mark as attached when fs.watch actually succeeded; failed
        // attaches (ENOENT for missing openspec/changes/, EMFILE, etc.)
        // remain eligible for retry on the next tick, so a cwd that gains
        // openspec/changes/ later lights up within one poll interval.
        // See change: fix-openspec-taskcheck-delay.
        if (changeWatcher.attach(cwd)) attachedWatcherCwds.add(cwd);
      }
    }
    for (const cwd of Array.from(attachedWatcherCwds)) {
      if (!known.has(cwd)) {
        changeWatcher.detach(cwd);
        attachedWatcherCwds.delete(cwd);
      }
    }
  }

  /**
   * Broadcast the transitional `{ initialized:false, pending:true }` snapshot
   * before the slow `openspec list` spawn, for any cwd whose
   * `<cwd>/openspec/changes/` exists (cheap synchronous stat) but whose cache
   * does not yet hold authoritative `initialized:true` data. Fires via the
   * `onChangeCallback` installed by `startPolling` (null no-ops). All three
   * broadcast wrappers — periodic tick, watcher-fired re-poll, and
   * `onDirectoryAdded` — funnel through `pollDirectoryGated`, so this single
   * call covers every path that can surface a newly-present openspec dir while
   * `pollOne` stays pure (returns data only). The `initialized:true` guard
   * suppresses repeats on steady-state ticks and the post-bulk-archive refresh.
   * The final authoritative payload follows from each wrapper when the CLI
   * returns. See change: emit-openspec-pending-from-poll.
   */
  function emitPendingIfDiscovered(cwd: string): void {
    if (statMtimeOr(path.join(cwd, "openspec", "changes")) === undefined) return; // not pollable → no spinner
    if (caches.get(cwd)?.data?.initialized === true) return; // already authoritative
    pendingEmittedCwds.add(cwd);
    onChangeCallback?.(cwd, { initialized: false, pending: true, changes: [], hasOpenspecDir: true });
  }

  async function pollDirectoryGated(cwd: string): Promise<OpenSpecData> {
    // Master gate: when `openspec.enabled` is false, never spawn a CLI for the
    // periodic poll path either. See change: auto-hide-empty-session-subcards.
    if (cfg.enabled === false) {
      const cleared: OpenSpecData = { initialized: false, pending: false, changes: [], hasOpenspecDir: false };
      const cache = caches.get(cwd) ?? emptyDirCache();
      cache.data = cleared;
      caches.set(cwd, cache);
      return cleared;
    }
    emitPendingIfDiscovered(cwd);
    return pollOne(cwd, false);
  }

  async function refreshPiResourcesInternal(cwd: string): Promise<PiResourcesResult> {
    const data = await scanPiResources(cwd);
    piResourcesCache.set(cwd, data);
    return data;
  }

  // ── Scheduler ────────────────────────────────────────────────────
  const TICK_SLOW_WARN_MS = 5000;
  const DEBUG_ENABLED =
    typeof process !== "undefined" && typeof process.env?.DEBUG === "string" && /pi-dashboard|openspec-poll/.test(process.env.DEBUG);

  let openspecTickInFlight = false;
  async function scheduleOpenSpecTick() {
    if (openspecTickInFlight) return;
    // Master gate: when `openspec.enabled` is false, the tick is a no-op.
    // No CLI spawns. See change: auto-hide-empty-session-subcards.
    if (cfg.enabled === false) return;
    openspecTickInFlight = true;
    // Reconcile watcher attachments at the top of every tick. Catches
    // newly-known cwds (e.g. session_register) and forgotten ones (unpin /
    // last session ended) without needing explicit lifecycle hooks.
    // See change: fix-openspec-taskcheck-delay.
    try { reconcileWatchers(); } catch (err) { console.warn("[openspec-watcher] reconcile failed:", err); }
    const tickStart = Date.now();
    let spawnsBefore = 0;
    let spawnsAfter = 0;
    try {
      const dirs = computeKnownDirectories();
      // Track spawn count by hooking the semaphore's size(). Approximation.
      spawnsBefore = semaphore.size();
      await Promise.all(dirs.map((cwd) => new Promise<void>((resolve) => {
        const delay = phaseOffsetMs(cwd, cfg.jitterSeconds);
        const timer = setTimeout(async () => {
          scheduledPhaseTimers.delete(timer);
          try {
            const prev = caches.get(cwd)?.data;
            const prevJson = prev ? JSON.stringify(prev) : undefined;
            const next = await pollDirectoryGated(cwd);
            const nextJson = JSON.stringify(next);
            // See change: emit-openspec-pending-from-poll — clear the spinner
            // even when the final JSON equals the prior cache.
            const pendingWasEmitted = pendingEmittedCwds.delete(cwd);
            if (nextJson !== prevJson || pendingWasEmitted) onChangeCallback?.(cwd, next);
          } catch (err) {
            // Swallow — the next tick will retry.
            console.error(`[openspec-poll] tick failed for ${cwd}:`, err);
          } finally {
            resolve();
          }
        }, delay);
        scheduledPhaseTimers.add(timer);
      })));
      spawnsAfter = semaphore.size();
    } finally {
      openspecTickInFlight = false;
      const durationMs = Date.now() - tickStart;
      if (DEBUG_ENABLED) {
        const dirs = computeKnownDirectories().length;
        // eslint-disable-next-line no-console
        console.log(`[openspec-poll] tick dirs=${dirs} queueBefore=${spawnsBefore} queueAfter=${spawnsAfter} durationMs=${durationMs}`);
      }
      if (durationMs > TICK_SLOW_WARN_MS) {
        console.warn(`[openspec-poll] slow tick: ${durationMs}ms (threshold ${TICK_SLOW_WARN_MS}ms). Consider raising pollIntervalSeconds or lowering maxConcurrentSpawns.`);
      }
    }
  }

  let piResourcesInFlight = false;
  async function schedulePiResourcesTick() {
    if (piResourcesInFlight) return;
    piResourcesInFlight = true;
    try {
      await Promise.all(computeKnownDirectories().map(async (cwd) => {
        try { await refreshPiResourcesInternal(cwd); }
        catch { /* ignore, next tick retries */ }
      }));
    } finally {
      piResourcesInFlight = false;
    }
  }

  function installTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (piResourcesTimer) clearInterval(piResourcesTimer);
    pollTimer = setInterval(scheduleOpenSpecTick, cfg.pollIntervalSeconds * 1000);
    // Pi resources change far less often; poll at 5× the openspec interval.
    piResourcesTimer = setInterval(schedulePiResourcesTick, cfg.pollIntervalSeconds * 5 * 1000);
  }

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (piResourcesTimer) { clearInterval(piResourcesTimer); piResourcesTimer = null; }
    for (const t of scheduledPhaseTimers) clearTimeout(t);
    scheduledPhaseTimers.clear();
  }

  return {
    knownDirectories: computeKnownDirectories,
    discoverSessions,
    loadSessionEvents,

    getOpenSpecData(cwd: string): OpenSpecData | undefined {
      return caches.get(cwd)?.data;
    },

    refreshOpenSpec,
    pollDirectoryGated,

    getPiResources(cwd: string): PiResourcesResult | undefined {
      return piResourcesCache.get(cwd);
    },

    async refreshPiResources(cwd: string): Promise<PiResourcesResult> {
      return refreshPiResourcesInternal(cwd);
    },

    startPolling(onChange: (cwd: string, data: OpenSpecData) => void) {
      onChangeCallback = onChange;
      installTimers();
    },

    stopPolling() {
      stopTimers();
      onChangeCallback = null;
      // Tear down every per-cwd fs.watch so the process can exit cleanly.
      // See change: fix-openspec-taskcheck-delay.
      try { changeWatcher.detachAll(); } catch { /* best-effort */ }
      attachedWatcherCwds.clear();
    },

    reconfigurePolling(newCfg: OpenSpecPollConfig) {
      const oldInterval = cfg.pollIntervalSeconds;
      const wasEnabled = cfg.enabled;
      cfg = { ...newCfg };
      semaphore.setMax(cfg.maxConcurrentSpawns);
      // Only re-install timers if they were running and the interval actually changed.
      if (pollTimer && oldInterval !== cfg.pollIntervalSeconds) {
        installTimers();
      }
      // On the `true → false` transition, clear every per-cwd `OpenSpecData`
      // cache and notify the broadcast channel so connected browsers converge
      // to the disabled-state shape. The `false → true` transition is a
      // no-op here — the next regular poll tick will re-populate caches.
      // See change: auto-hide-empty-session-subcards.
      if (wasEnabled !== false && cfg.enabled === false) {
        const cleared: OpenSpecData = { initialized: false, pending: false, changes: [], hasOpenspecDir: false };
        for (const [cwd, cache] of caches.entries()) {
          cache.data = cleared;
          caches.set(cwd, cache);
          try {
            onChangeCallback?.(cwd, cleared);
          } catch (err) {
            console.warn(`[openspec-poll] onChange after disable failed for ${cwd}:`, err);
          }
        }
      }
    },

    async onDirectoryAdded(cwd: string): Promise<DirectoryAddedResult> {
      // Internal path — use the gated poll, not the user-facing
      // `refreshOpenSpec` (which now bypasses the gate). For a freshly-added
      // directory the cache is empty, so the gate lets the CLI run anyway.
      // See change: fix-openspec-mtime-gate-toctou.
      const [sessions, openspecData] = await Promise.all([
        discoverSessions(cwd),
        pollDirectoryGated(cwd),
      ]);
      // The caller (event-wiring `onDirectoryAdded`) broadcasts `openspecData`
      // unconditionally, so any transitional pending emitted by the gated poll
      // is already cleared here — drop the flag so the next tick doesn't fire a
      // stale duplicate broadcast. See change: emit-openspec-pending-from-poll.
      pendingEmittedCwds.delete(cwd);
      // Attach the per-cwd fs.watch immediately so subsequent edits to
      // tasks.md / proposal.md / design.md / specs/**/*.md trigger a
      // sub-second refresh. Mark only on success; failed attaches (missing
      // openspec/changes/) get retried by `reconcileWatchers` on the next
      // poll tick. See change: fix-openspec-taskcheck-delay.
      if (!attachedWatcherCwds.has(cwd)) {
        if (changeWatcher.attach(cwd)) attachedWatcherCwds.add(cwd);
      }
      return { sessions, openspecData };
    },
  };
}
