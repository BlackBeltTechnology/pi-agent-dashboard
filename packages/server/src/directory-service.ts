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
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserGitHeadUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { DEFAULT_OPENSPEC_POLL, type OpenSpecPollConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  buildOpenSpecData,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
  deriveArtifactStatus,
  pollOpenSpecAsync,
  runOpenSpecList,
  runOpenSpecStatus,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { createSemaphore, type Semaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";
import { inferPlatform, pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { computeFolderGroupKeys, createFolderHeadPoll, type FolderHeadPoll } from "./git-worktree/folder-head-poll.js";
import { deriveOpenSpecReadiness, type BrokeReason } from "./openspec/readiness.js";
import type { EventLoopSpikeMetrics, EventLoopTurn } from "./metrics/eventloop-spike-metrics.js";

/**
 * Debounce for the folder-HEAD entry refresh, so a registration burst collapses
 * into one bounded fan-out. See change: fix-folder-header-worktree-branch-leak.
 */
const FOLDER_HEAD_ENTRY_DEBOUNCE_MS = 500;

import { createFolderHeadWatcher, type FolderHeadWatcher } from "./git-worktree/folder-head-watcher.js";
import type { HeadInfo } from "./git-worktree/git-operations.js";
import { resolveConfigRoot } from "./git-worktree/git-operations.js";
import type { HydrationMetrics } from "./metrics/hydration-metrics.js";
import { createOpenSpecChangeWatcher, type OpenSpecChangeWatcher } from "./openspec/openspec-change-watcher.js";
import {
  effectiveMtimeOr,
  perChangeArtifactPaths,
  statMtimeOr,
} from "./openspec/openspec-poll-fs-helpers.js";
import type {
  PollWorkerPerChangeIn,
  PollWorkerRequest,
} from "./openspec/openspec-poll-worker.js";
import {
  createOpenSpecPollWorkerPool,
  type PollWorkerPool,
} from "./openspec/openspec-poll-worker-pool.js";
import type { PreferencesStore } from "./persistence/preferences-store.js";
import { scanPiResources } from "./pi/pi-resource-scanner.js";
import type { SessionManager } from "./session/memory-session-manager.js";
import { discoverSessionsForCwd } from "./session/session-discovery.js";
import {
  createSessionLoadWorkerPool,
  type SessionLoadWorkerPool,
} from "./session/session-load-worker-pool.js";

// Re-export `effectiveMtimeOr` here to preserve the prior public symbol for
// external importers. See change: offload-openspec-poll-to-worker.
export { effectiveMtimeOr } from "./openspec/openspec-poll-fs-helpers.js";

import type { DiscoveredSession } from "./session/session-discovery.js";

export type { DiscoveredSession } from "./session/session-discovery.js";

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
  /**
   * Cancel an in-flight hydration for `sessionId` (e.g. on unsubscribe before
   * it resolves). No-op when no load is in flight. The cancelled load's
   * `loadSessionEvents` promise resolves `{success:false, error:"cancelled"}`
   * so callers skip the insert/broadcast. See change:
   * offload-session-events-load-to-worker.
   */
  cancelLoad(sessionId: string): void;
  getOpenSpecData(cwd: string): OpenSpecData | undefined;
  /** Force refresh: bypasses the mtime gate. Still honors the semaphore. */
  refreshOpenSpec(cwd: string): Promise<OpenSpecData>;
  /** Gated poll: respects `changeDetection` config and the semaphore. Returns cached data. */
  pollDirectoryGated(cwd: string): Promise<OpenSpecData>;
  getPiResources(cwd: string): PiResourcesResult | undefined;
  refreshPiResources(cwd: string): Promise<PiResourcesResult>;
  /**
   * Subscribe to OpenSpec updates. The optional `serialized` arg carries the
   * worker's pre-stringified `data` (matches `JSON.stringify(data)` byte-for-byte).
   * Broadcast wiring can pass it straight through to the wire so the payload
   * is stringified exactly once per tick. Pending / disabled / force-path
   * emits omit `serialized` and callers re-stringify as needed.
   * See change: offload-openspec-poll-to-worker.
   */
  startPolling(
    onChange: (cwd: string, data: OpenSpecData, serialized?: string) => void,
    onFolderHead?: (msg: BrowserGitHeadUpdateMessage) => void,
  ): void;
  stopPolling(): void;
  /** Apply a new OpenSpecPollConfig without losing cache. Safe to call mid-stream. */
  reconfigurePolling(config: OpenSpecPollConfig): void;
  /**
   * Drop the memoized current-global-signature. Called by the routes after a
   * profile save, init, or update so the next poll tick recomputes it instead
   * of serving a stale value. See change: add-openspec-init-affordances.
   */
  invalidateOpenSpecSignatureCache(): void;
  onDirectoryAdded(cwd: string): Promise<DirectoryAddedResult>;
  /**
   * Read-only snapshot of the folder-HEAD diff cache, for the browser connect
   * snapshot. Empty when the lazily-created poll does not exist (polling not
   * started, or already stopped). PURE — never mutates the cache.
   * See change: fix-folder-header-worktree-branch-leak.
   */
  folderHeadSnapshot(): Array<{ cwd: string; branch: string | null }>;
  /**
   * Refresh the HEAD of every folder group key that ENTERED the observed set
   * since the last recompute, without waiting for the next periodic cycle.
   * Debounced (~500ms) so a registration burst collapses into one fan-out.
   *
   * Declared REQUIRED, but call sites still guard (`?.()` in `event-wiring`,
   * `typeof … === "function"` in `browser-gateway`): hand-built
   * `DirectoryService` fakes cast a fixed field set through
   * `as unknown as DirectoryService`, so the type is only a compile-time claim
   * about a runtime object that lacks the method.
   * See change: fix-folder-header-worktree-branch-leak.
   */
  refreshFolderHeadsForEnteringKeys(): void;
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

// mtime helpers live in `./openspec-poll-fs-helpers.ts` (shared with the
// `openspec-poll-worker.ts` worker). See change: offload-openspec-poll-to-worker.

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
  /**
   * Pre-stringified payload from the worker. When present and matches
   * `JSON.stringify(data)`, broadcast wrappers reuse this string so the main
   * loop never re-stringifies the large payload. Reset to `undefined` on
   * force-path refresh or any code path that mutates `data` without setting
   * this. See change: offload-openspec-poll-to-worker.
   */
  serialized: string | undefined;
};

function emptyDirCache(): DirCache {
  return { listMtimeMs: undefined, listResult: undefined, changes: new Map(), data: undefined, serialized: undefined };
}

export interface DirectoryServiceOptions {
  /**
   * Optional async post-processor applied to `OpenSpecData` after
   * `buildOpenSpecData` and before caching. Used to inject the per-cwd
   * `groupId` join from the OpenSpec change-grouping store. Used by the
   * force-refresh path (`pollOne(force=true)`). The periodic / gated path
   * (`pollOne(force=false)`) uses `getOpenSpecGroupAssignments` so the join
   * can run inside the worker without crossing the main→worker boundary
   * with a Promise-returning callback.
   * Errors propagate as a logged warning + the unenriched data.
   * See change: add-openspec-change-grouping.
   */
  enrichOpenSpecData?: (cwd: string, data: OpenSpecData) => Promise<OpenSpecData> | OpenSpecData;
  /**
   * Optional async fetcher for the per-cwd `groupId` assignments map (change
   * name → groupId). When set, the periodic / gated poll path resolves
   * assignments on the main thread (cheap group-store file read) and passes
   * them into the worker so the worker emits a fully-joined, ready-to-broadcast
   * payload. Errors fall back to an empty assignments map. See change:
   * offload-openspec-poll-to-worker.
   */
  getOpenSpecGroupAssignments?: (cwd: string) => Promise<Record<string, string>> | Record<string, string>;
  /**
   * Optional override for the per-cwd OpenSpec change watcher. When omitted,
   * a real `fs.watch`-backed watcher is constructed. Tests may inject a
   * stub to avoid touching the real filesystem.
   * See change: fix-openspec-taskcheck-delay.
   */
  changeWatcher?: OpenSpecChangeWatcher;
  /**
   * Optional override for the folder-HEAD fs.watch watcher. When omitted, a
   * real `fs.watch`-backed watcher is constructed. Tests may inject a stub.
   * See change: refresh-folder-header-branch.
   */
  folderHeadWatcher?: FolderHeadWatcher;
  /**
   * Optional override for the folder-HEAD HEAD reader (may be sync or async).
   * When omitted, the async non-blocking `readHeadDisplayAsync` is used. Tests
   * inject a fast deterministic reader (no real git spawn). See change:
   * attribute-openspec-poll-eventloop-stalls.
   */
  folderHeadReadHead?: (cwd: string) => Promise<HeadInfo> | HeadInfo;
  /**
   * Shared in-memory recorder for session-hydration timings. When set,
   * `loadSessionEvents` records a sample per call and the same instance is
   * read by `/api/health`. See change: instrument-session-hydration-timing.
   */
  hydrationMetrics?: HydrationMetrics;
  /**
   * Shared ring buffer for worst-case event-loop stalls. When set, each
   * instrumented poll turn (`tickOpen`, `dirPollPre`, `dirPollPost`) whose own
   * synchronous run exceeds `eventLoopSpikeFloorMs` self-records `{at, ms, turn}`.
   * Read by `/api/health`. See change: attribute-openspec-poll-eventloop-stalls.
   */
  eventLoopSpikes?: EventLoopSpikeMetrics;
  /**
   * Floor (ms) at or above which an instrumented turn self-records a spike.
   * Default 100. See change: attribute-openspec-poll-eventloop-stalls.
   */
  eventLoopSpikeFloorMs?: number;
  /**
   * Per-turn slow-tick alarm threshold (ms). Independent of the retained wall
   * `durationMs` alarm: fires when any single instrumented turn's synchronous
   * run exceeds this, naming the turn. Default 250. See change:
   * attribute-openspec-poll-eventloop-stalls.
   */
  perTurnWarnMs?: number;
  /**
   * When `false`, session-event hydration runs in-process (no worker spawn).
   * Default `true`. Mirrors `DashboardConfig.sessions.useLoadWorker`. See
   * change: offload-session-events-load-to-worker.
   */
  useLoadWorker?: boolean;
  /**
   * Provider for the CURRENT global OpenSpec workflow-set signature, injected
   * from the routes layer (the CLI-spawning helper is closure-local there).
   * The signature is machine-global — identical for every cwd — so the polling
   * service calls it at most once per poll generation and memoizes the
   * promise; the memo is dropped on `invalidateOpenSpecSignatureCache()`.
   * A rejected provider NEVER marks a cwd STALE (failure → unknown → skip the
   * signature-staleness check). See change: add-openspec-init-affordances.
   */
  currentGlobalSignature?: (cwd: string) => Promise<string>;
}

export function createDirectoryService(
  preferencesStore: PreferencesStore,
  sessionManager: SessionManager,
  initialConfig?: Partial<OpenSpecPollConfig>,
  options: DirectoryServiceOptions = {},
): DirectoryService {
  let cfg: OpenSpecPollConfig = { ...DEFAULT_OPENSPEC_POLL, ...(initialConfig ?? {}) };

  // ── Readiness fold machinery (add-openspec-init-affordances) ──────
  //
  // Memoized per-cwd config-root resolution. `resolveConfigRoot` spawns git;
  // calling it per cwd per TICK would blow the stat-pass budget (P4), so each
  // cwd resolves at most once per process (a cwd does not stop being a
  // worktree). `null` (unresolvable) falls back to the cwd itself (E15/X11).
  const readinessConfigRoots = new Map<string, string | null>();
  function configRootFor(cwd: string): string {
    if (!readinessConfigRoots.has(cwd)) {
      let root: string | null = null;
      try {
        root = resolveConfigRoot(cwd);
      } catch {
        root = null;
      }
      readinessConfigRoots.set(cwd, root);
    }
    return readinessConfigRoots.get(cwd) ?? cwd;
  }

  /** `.pi/skills/openspec-explore/` exists at the resolved config root. */
  function hasOpenSpecSkillsFor(cwd: string): boolean {
    const root = configRootFor(cwd);
    return statMtimeOr(path.join(root, ".pi", "skills", "openspec-explore")) !== undefined;
  }

  /** cwd listed in `openspec.optOutDirectories` (pathKey-normalized match). */
  function isOptedOutCwd(cwd: string): boolean {
    if (cfg.optOutDirectories.length === 0) return false;
    const platform = inferPlatform([cwd, ...cfg.optOutDirectories]);
    const cwdKey = pathKey(cwd, platform);
    return cfg.optOutDirectories.some((d) => pathKey(d, platform) === cwdKey);
  }

  // Memoized current-global-signature, keyed by poll generation. One spawn
  // per tick (P1); bumped generations and explicit invalidation recompute.
  // `resolved` tracks the provider's value so the SYNCHRONOUS reconfigure
  // path can reuse it; a failed provider leaves it undefined and no cwd is
  // ever falsely STALE (X10).
  let sigGeneration = 0;
  let sigMemo: { gen: number; promise: Promise<string | undefined>; resolved?: string } | null = null;
  function signatureForTick(): Promise<string | undefined> {
    if (!options.currentGlobalSignature) return Promise.resolve(undefined);
    if (!sigMemo || sigMemo.gen !== sigGeneration) {
      const memo: (typeof sigMemo) = { gen: sigGeneration, promise: Promise.resolve(undefined) };
      memo.promise = options.currentGlobalSignature(process.cwd()).then(
        (v) => {
          memo.resolved = v;
          return v;
        },
        () => undefined,
      );
      sigMemo = memo;
    }
    return sigMemo.promise;
  }
  function invalidateOpenSpecSignatureCache(): void {
    sigMemo = null;
  }

  /**
   * Attach `hasOpenSpecSkills` + `readiness` to a polled payload. Awaited at
   * every pollOne exit; the signature await is already-resolved in the
   * steady state (memoized per tick).
   */
  async function finalizeOpenSpecData(cwd: string, d: OpenSpecData, breakReason?: BrokeReason): Promise<OpenSpecData> {
    const skills = d.hasOpenSpecSkills ?? hasOpenSpecSkillsFor(cwd);
    // Optional call: standalone directory-service constructions (tests) may
    // pass a narrower preferences-store stub without the signature API.
    const recorded = preferencesStore.getOpenSpecUpdateSignature?.(cwd) as string | undefined;
    const needsSigCheck =
      recorded !== undefined && skills !== false && d.initialized === true && d.pending !== true;
    const current = needsSigCheck ? await signatureForTick() : undefined;
    const readiness = deriveOpenSpecReadiness(
      {
        enabled: cfg.enabled !== false,
        optedOut: isOptedOutCwd(cwd),
        pending: d.pending === true,
        hasOpenspecDir: d.hasOpenspecDir === true,
        initialized: d.initialized === true,
        hasOpenSpecSkills: skills,
        recordedSignature: recorded,
        currentSignature: current,
      },
      d,
      { breakReason },
    );
    return { ...d, hasOpenSpecSkills: skills, readiness };
  }

  /** Cleared disabled payload — allocation-only, no stat, no CLI. */
  function clearedDisabledPayload(): OpenSpecData {
    return { initialized: false, pending: false, changes: [], hasOpenspecDir: false, readiness: { state: "GLOBAL_OFF" } };
  }

  const enrichOpenSpecData = options.enrichOpenSpecData;
  const getOpenSpecGroupAssignments = options.getOpenSpecGroupAssignments;
  const hydrationMetrics = options.hydrationMetrics;
  // Reuse the openspec-poll slow-tick convention for the hydration warning.
  const HYDRATION_SLOW_WARN_MS = 5000;

  // Per-turn event-loop attribution. `eventLoopSpikes` (when set) receives a
  // self-record for any instrumented turn whose OWN synchronous run exceeds
  // `eventLoopSpikeFloorMs`; the per-turn alarm fires (independently of the
  // wall `durationMs` alarm) at `perTurnWarnMs`. Attribution is per single
  // synchronous turn, NEVER a sum across turns.
  // See change: attribute-openspec-poll-eventloop-stalls.
  const eventLoopSpikes = options.eventLoopSpikes;
  const eventLoopSpikeFloorMs = Number.isFinite(options.eventLoopSpikeFloorMs)
    ? Math.max(0, options.eventLoopSpikeFloorMs as number)
    : 100;
  const perTurnWarnMs = Number.isFinite(options.perTurnWarnMs)
    ? Math.max(1, options.perTurnWarnMs as number)
    : 250;
  /**
   * Time a single synchronous event-loop turn: given its `performance.now()`
   * start, self-record `{at, ms, turn}` when its run reaches the spike floor,
   * and emit the per-turn slow-tick warning when it reaches `perTurnWarnMs`.
   * Measurement failures never propagate. Call at the turn's synchronous exit
   * (before any `await`), NEVER across an await. See change above.
   */
  function recordTurn(turn: Exclude<EventLoopTurn, null>, startPerf: number): void {
    try {
      const ms = performance.now() - startPerf;
      if (ms >= eventLoopSpikeFloorMs) {
        eventLoopSpikes?.record({ at: Date.now(), ms, turn });
      }
      if (ms >= perTurnWarnMs) {
        console.warn(
          `[openspec-poll] slow turn: ${turn} ${Math.round(ms)}ms (threshold ${perTurnWarnMs}ms). Single synchronous turn blocked the event loop.`,
        );
      }
    } catch { /* attribution must never break the poll */ }
  }

  // Lazy worker pool for the periodic / gated poll path. Constructed on
  // `startPolling()`; disposed on `stopPolling()`. `cfg.useWorker === false`
  // produces an in-process-only pool (no thread spawn). See change:
  // offload-openspec-poll-to-worker.
  let workerPool: PollWorkerPool | null = null;
  function ensureWorkerPool(): PollWorkerPool {
    if (workerPool) return workerPool;
    const cpuCount = os.cpus().length || 1;
    workerPool = createOpenSpecPollWorkerPool({
      size: Math.max(1, Math.min(cfg.maxConcurrentSpawns, cpuCount)),
      useWorker: cfg.useWorker !== false,
    });
    return workerPool;
  }

  // Per-cwd `fs.watch` on `openspec/changes/`. On a relevant file event
  // (debounced 300 ms) fans into `pollOne(cwd, false)` so the existing
  // mtime-gate + semaphore + broadcast dedup do their job. Periodic poll
  // remains as the fallback for missed events (network FS, EMFILE, etc.).
  // See change: fix-openspec-taskcheck-delay.
  const changeWatcher: OpenSpecChangeWatcher = options.changeWatcher ?? createOpenSpecChangeWatcher({
    onChange: (cwd) => { void onWatcherFired(cwd); },
  });
  const attachedWatcherCwds = new Set<string>();

  // Folder-HEAD poll + watcher. The poll is constructed lazily on
  // `startPolling` once the broadcast callback is known. The watcher is a
  // fast trigger that fans HEAD-file events into `folderHeadPoll.refreshOne`
  // (single broadcast path — never a parallel poll). Both recompute their
  // work set from `computeFolderGroupKeys` each tick.
  // See change: refresh-folder-header-branch.
  let folderHeadPoll: FolderHeadPoll | null = null;
  const folderHeadWatcher: FolderHeadWatcher = options.folderHeadWatcher ?? createFolderHeadWatcher({
    // `refreshOne` is async (non-blocking git read); fire-and-forget with a
    // catch so a rejected read can't surface as an unhandled rejection.
    // See change: attribute-openspec-poll-eventloop-stalls.
    onChange: (cwd) => { folderHeadPoll?.refreshOne(cwd)?.catch(() => { /* logged inside */ }); },
  });
  const attachedFolderHeadCwds = new Set<string>();
  // The most recently COMPUTED folder group-key set, held as CANONICAL
  // `pathKey`s rather than display paths: cosmetic display drift (`/repo` vs
  // `/repo/`, drive-letter or case changes, a pin swapping which display path
  // wins a collision) would otherwise read as a key ENTERING the set and cost a
  // redundant git read on every drift. `computeFolderGroupKeys` already
  // de-duplicates by `pathKey`, so this just keeps the entry predicate on the
  // same footing. Display paths are still what gets read and broadcast.
  //
  // Single writer: `recomputeFolderHeadKeys` below, called by the periodic tick
  // and by every entry trigger. Two independent updaters would let a
  // trigger-side recompute mark a key "previously seen" that no refresh read.
  // See change: fix-folder-header-worktree-branch-leak.
  let previousFolderHeadKeys = new Set<string>();
  let folderHeadEntryTimer: ReturnType<typeof setTimeout> | null = null;

  const caches = new Map<string, DirCache>();
  const piResourcesCache = new Map<string, PiResourcesResult>();

  const semaphore: Semaphore = createSemaphore(cfg.maxConcurrentSpawns);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let piResourcesTimer: ReturnType<typeof setInterval> | null = null;
  let onChangeCallback: ((cwd: string, data: OpenSpecData, serialized?: string) => void) | null = null;
  const scheduledPhaseTimers = new Set<ReturnType<typeof setTimeout>>();
  // cwds for which the current poll cycle broadcast a transitional
  // `pending:true` that the diff-guarded wrappers must still clear, even when
  // the final payload's JSON equals the prior cache (e.g. a second
  // back-to-back empty/failed poll). Without this the spinner would stay stuck
  // after the pending emit. See change: emit-openspec-pending-from-poll.
  const pendingEmittedCwds = new Set<string>();

  // In-progress session loads for dedup
  const loadingSet = new Set<string>();

  // Lazy session-load worker pool. Constructed on first `loadSessionEvents`;
  // disposed on `stopPolling`. `useLoadWorker === false` → in-process-only
  // pool (no thread spawn). Maps sessionId → in-flight jobId so `cancelLoad`
  // can drop a wasted hydration. See change: offload-session-events-load-to-worker.
  let loadWorkerPool: SessionLoadWorkerPool | null = null;
  const useLoadWorker = options.useLoadWorker !== false;
  const inFlightLoadJobs = new Map<string, number>();
  function ensureLoadWorkerPool(): SessionLoadWorkerPool {
    if (loadWorkerPool) return loadWorkerPool;
    const cpuCount = os.cpus().length || 1;
    loadWorkerPool = createSessionLoadWorkerPool({
      size: Math.max(1, Math.min(cfg.maxConcurrentSpawns, cpuCount)),
      useWorker: useLoadWorker,
    });
    return loadWorkerPool;
  }

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
    // Instrumentation only — never alters the returned LoadResult. fileBytes
    // is best-effort (stat may race a delete). entry/event counts default to
    // 0 on the failure path. See change: instrument-session-hydration-timing.
    const start = performance.now();
    let fileBytes = 0;
    try {
      fileBytes = fs.statSync(sessionFile).size;
    } catch {
      // ignore — fileBytes stays 0
    }
    let entryCount = 0;
    let eventCount = 0;
    // Parse + replay run in a worker_threads worker (off the main loop) when
    // `useLoadWorker` is on; the pool falls back in-process on
    // spawn/crash/timeout. `cancelLoad(sessionId)` drops the job via this
    // jobId. See change: offload-session-events-load-to-worker.
    const pool = ensureLoadWorkerPool();
    const { jobId, result } = pool.load({ sessionId, sessionFile, knownContextWindow });
    inFlightLoadJobs.set(sessionId, jobId);
    try {
      const out = await result;
      entryCount = out.entryCount ?? 0;
      eventCount = out.events.length;
      if (out.success) return { success: true, events: out.events };
      return { success: false, events: [], error: out.error };
    } finally {
      loadingSet.delete(sessionId);
      inFlightLoadJobs.delete(sessionId);
      // Instrumentation must never change the load outcome — isolate any
      // recorder/logging throw so it can't reject a successful LoadResult.
      try {
        const wallMs = performance.now() - start;
        hydrationMetrics?.record({ sessionId, wallMs, fileBytes, entryCount, eventCount, at: Date.now() });
        if (wallMs > HYDRATION_SLOW_WARN_MS) {
          console.warn(`[hydration] slow load: ${Math.round(wallMs)}ms (session=${sessionId} bytes=${fileBytes})`);
        }
      } catch {
        // swallow — measurement-only path
      }
    }
  }

  function cancelLoad(sessionId: string): void {
    const jobId = inFlightLoadJobs.get(sessionId);
    if (jobId !== undefined) loadWorkerPool?.cancel(jobId);
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
      // BROKEN · missing-changes-dir: `openspec/` exists but `changes/` does
      // not — remediable by re-running init. See change:
      // add-openspec-init-affordances.
      const empty = await finalizeOpenSpecData(
        cwd,
        { initialized: false, changes: [], hasOpenspecDir },
        "missing-changes-dir",
      );
      cache.data = empty;
      cache.listMtimeMs = undefined;
      cache.listResult = undefined;
      cache.serialized = undefined;
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
        // BROKEN · cli-failed: the CLI itself failed — NOT remediable by
        // re-running init with --force. See change:
        // add-openspec-init-affordances.
        const empty = await finalizeOpenSpecData(
          cwd,
          { initialized: false, changes: [], hasOpenspecDir },
          "cli-failed",
        );
        cache.data = empty;
        cache.listMtimeMs = rootMtime;
        cache.listResult = undefined;
        cache.serialized = undefined;
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

    // ── Step 2 + 3 (gated, non-force): dispatch to worker pool ──
    //
    // The worker computes pre/post-call mtimes, runs `deriveArtifactStatus`
    // per change, applies the TOCTOU gate, assembles `buildOpenSpecData`,
    // joins `groupAssignments`, and serializes the payload — all off the
    // main event loop. The main thread keeps ownership of the CLI spawn
    // (above), the spawn semaphore, the cache, and the broadcast.
    // See change: offload-openspec-poll-to-worker.
    if (!force) {
      const perChange: PollWorkerPerChangeIn[] = (listResult ?? []).map((c) => {
        const cached = cache.changes.get(c.name);
        return {
          name: c.name,
          cached: cached
            ? {
                mtimeMs: cached.mtimeMs,
                artifacts: cached.change.artifacts.map((a) => ({ id: a.id, status: a.status })),
                ...(cached.change.isComplete !== undefined ? { isComplete: cached.change.isComplete } : {}),
              }
            : null,
        };
      });

      let groupAssignments: Record<string, string> = {};
      if (getOpenSpecGroupAssignments) {
        try {
          groupAssignments = await Promise.resolve(getOpenSpecGroupAssignments(cwd));
          if (!groupAssignments || typeof groupAssignments !== "object") groupAssignments = {};
        } catch (err) {
          if (typeof process !== "undefined" && /pi-dashboard|openspec-poll/.test(process.env?.DEBUG ?? "")) {
            // eslint-disable-next-line no-console
            console.warn(`[directory-service] getOpenSpecGroupAssignments(${cwd}) threw:`, err);
          }
          groupAssignments = {};
        }
      }

      const req: PollWorkerRequest = {
        cwd,
        changesRoot,
        hasOpenspecDir,
        gateEnabled,
        listResult: listResult ?? [],
        perChange,
        groupAssignments,
      };
      const out = await ensureWorkerPool().process(req);
      const racySet = new Set(out.racyNames);
      for (const change of out.data.changes ?? []) {
        if (racySet.has(change.name)) continue; // preserve prior cache for racy
        cache.changes.set(change.name, { mtimeMs: out.stampMtimes[change.name], change });
      }
      // Attach hasOpenSpecSkills + readiness on the main thread — the worker
      // has neither the config, the preferences store, nor the signature
      // provider. The worker's pre-serialized payload no longer matches, so
      // the cached form is invalidated (one extra stringify per tick — the
      // correctness cost of the fold). See change:
      // add-openspec-init-affordances.
      const finalized = await finalizeOpenSpecData(cwd, out.data);
      cache.data = finalized;
      cache.serialized = undefined;
      caches.set(cwd, cache);
      return finalized;
    }

    // ── Force path (force === true): per-change `openspec status` CLI ──
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

    // Per-change evidence probes for the local-derivation path (kept here as
    // a defensive fallback; the force branch normally uses `runOpenSpecStatus`).
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

    // Attach hasOpenSpecSkills + readiness (force path). See change:
    // add-openspec-init-affordances.
    data = await finalizeOpenSpecData(cwd, data);

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
    // Force path serializes inline on the broadcast wrappers (rare, async
    // CLI-per-change path). Invalidate any stale worker-serialized form so
    // wrappers re-stringify against the fresh data. See change:
    // offload-openspec-poll-to-worker.
    cache.serialized = undefined;
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
      // hides the OPENSPEC subcard for every cwd; `readiness` carries
      // GLOBAL_OFF so current clients never fall into the legacy gate.
      // Allocation-only — no stat, no CLI. See changes:
      // auto-hide-empty-session-subcards, add-openspec-init-affordances.
      const cleared = clearedDisabledPayload();
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
      // Reuse the worker's pre-serialized payload when available so the
      // diff is free and `JSON.stringify` runs exactly once per tick.
      // See change: offload-openspec-poll-to-worker.
      const prevCache = caches.get(cwd);
      const prevJson = prevCache?.serialized ?? (prevCache?.data ? JSON.stringify(prevCache.data) : undefined);
      const next = await pollDirectoryGated(cwd);
      const nextSerialized = caches.get(cwd)?.serialized;
      const nextJson = nextSerialized ?? JSON.stringify(next);
      // Force the broadcast when a transitional pending was emitted this cycle,
      // so the terminal clear always reaches the spinner even if the final
      // JSON matches the prior cache. See change: emit-openspec-pending-from-poll.
      const pendingWasEmitted = pendingEmittedCwds.delete(cwd);
      if (nextJson !== prevJson || pendingWasEmitted) onChangeCallback?.(cwd, next, nextSerialized);
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
   * Folder-HEAD tick: recompute the folder group-key set, refresh each (read →
   * diff → broadcast), and reconcile watcher attachments to match the set
   * (attach folders entering, detach folders leaving). Runs every poll tick
   * INDEPENDENT of `cfg.enabled` (openspec disablement must not stop folder
   * HEAD refresh). No-op until `startPolling` installs the broadcast callback.
   * See change: refresh-folder-header-branch.
   */
  /**
   * THE single recompute path for the folder group-key set. Returns the fresh
   * key list plus the keys that were NOT in the previously computed set, and
   * atomically installs the fresh set as "previously computed". Called by the
   * periodic tick and by every entry trigger.
   * See change: fix-folder-header-worktree-branch-leak.
   */
  function recomputeFolderHeadKeys(): { keys: string[]; entering: string[] } {
    const sessions = sessionManager.listAll();
    const pinned = preferencesStore.getPinnedDirectories();
    const keys = computeFolderGroupKeys(sessions, pinned);
    // Same inference inputs as `computeFolderGroupKeys` uses internally, so the
    // canonical keys here fold exactly the drift it folds.
    const platform = inferPlatform([...sessions.map((s) => s.cwd), ...pinned]);
    const canonical = keys.map((k) => pathKey(k, platform));
    const entering = keys.filter((_k, i) => !previousFolderHeadKeys.has(canonical[i]));
    previousFolderHeadKeys = new Set(canonical);
    return { keys, entering };
  }

  /**
   * Entry refresh: read the HEAD of every key that entered the observed set
   * since the last recompute. Debounced so a registration burst collapses into
   * one bounded fan-out; the fan-out reuses the poll's read → diff → broadcast
   * funnel and its concurrency cap, so this is not a second broadcast path.
   * See change: fix-folder-header-worktree-branch-leak.
   */
  function refreshFolderHeadsForEnteringKeys(): void {
    if (!folderHeadPoll) return;
    if (folderHeadEntryTimer) return; // burst already collapsing into one fan-out
    folderHeadEntryTimer = setTimeout(() => {
      folderHeadEntryTimer = null;
      const poll = folderHeadPoll;
      if (!poll) return;
      const { entering } = recomputeFolderHeadKeys();
      if (entering.length === 0) return;
      void poll.refreshMany(entering).catch((err) => {
        console.warn("[folder-head] entry refresh failed:", err);
      });
    }, FOLDER_HEAD_ENTRY_DEBOUNCE_MS);
    folderHeadEntryTimer.unref?.();
  }

  async function tickFolderHeads(): Promise<void> {
    if (!folderHeadPoll) return;
    // Async, concurrency-bounded HEAD reads (no `execSync` burst on this turn).
    // See change: attribute-openspec-poll-eventloop-stalls.
    const { keys } = recomputeFolderHeadKeys();
    await folderHeadPoll.refreshMany(keys);
    const known = new Set(keys);
    for (const cwd of keys) {
      if (!attachedFolderHeadCwds.has(cwd)) {
        if (folderHeadWatcher.attach(cwd)) attachedFolderHeadCwds.add(cwd);
      }
    }
    for (const cwd of Array.from(attachedFolderHeadCwds)) {
      if (!known.has(cwd)) {
        folderHeadWatcher.detach(cwd);
        attachedFolderHeadCwds.delete(cwd);
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
    onChangeCallback?.(cwd, {
      initialized: false,
      pending: true,
      changes: [],
      hasOpenspecDir: true,
      readiness: { state: "PENDING" },
    });
  }

  async function pollDirectoryGated(cwd: string): Promise<OpenSpecData> {
    // Master gate: when `openspec.enabled` is false, never spawn a CLI for the
    // periodic poll path either. See change: auto-hide-empty-session-subcards.
    if (cfg.enabled === false) {
      const cleared = clearedDisabledPayload();
      const cache = caches.get(cwd) ?? emptyDirCache();
      cache.data = cleared;
      caches.set(cwd, cache);
      return cleared;
    }
    // Opt-out gate: an opted-out cwd is never polled and never spawns the
    // CLI. Its payload keeps the last observed shape but always carries the
    // OPTED_OUT readiness. See change: add-openspec-init-affordances.
    if (isOptedOutCwd(cwd)) {
      const base = caches.get(cwd)?.data;
      const payload: OpenSpecData = {
        initialized: false,
        pending: false,
        changes: [],
        hasOpenspecDir: base?.hasOpenspecDir ?? statMtimeOr(path.join(cwd, "openspec")) !== undefined,
        readiness: { state: "OPTED_OUT" },
      };
      const cache = caches.get(cwd) ?? emptyDirCache();
      cache.data = payload;
      caches.set(cwd, cache);
      return payload;
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
    // `tickOpen` = the `setInterval` fire's single synchronous turn:
    // `tickFolderHeads` + `reconcileWatchers` + `computeKnownDirectories` +
    // the timer setup, all before the first `await`. Time from entry and
    // self-record at each synchronous exit (early return OR just before the
    // `await Promise.all`). See change: attribute-openspec-poll-eventloop-stalls.
    const tickOpenStart = performance.now();
    // New poll generation: the memoized global signature recomputes lazily on
    // first use this tick (P1: at most one spawn per tick). See change:
    // add-openspec-init-affordances.
    sigGeneration++;
    // Folder-HEAD poll runs every tick regardless of openspec enablement and
    // regardless of an in-flight openspec tick. The HEAD reads are now async +
    // non-blocking (change: attribute-openspec-poll-eventloop-stalls) — the
    // previous synchronous `execSync` fan-out was the attributed ~700ms
    // `tickOpen` stall. Kick it off WITHOUT blocking the loop; await it before
    // the openspec fan-out so `git_head_update` still precedes `openspec_update`
    // per cwd. See change: refresh-folder-header-branch.
    const folderHeadDone = tickFolderHeads().catch((err) => { console.warn("[folder-head] tick failed:", err); });
    if (openspecTickInFlight) { recordTurn("tickOpen", tickOpenStart); await folderHeadDone; return; }
    // Master gate: when `openspec.enabled` is false, the tick is a no-op.
    // No CLI spawns. See change: auto-hide-empty-session-subcards.
    if (cfg.enabled === false) { recordTurn("tickOpen", tickOpenStart); await folderHeadDone; return; }
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
      // Opted-out cwds are never polled (no timers created for them). See
      // change: add-openspec-init-affordances.
      const dirs = computeKnownDirectories().filter((d) => !isOptedOutCwd(d));
      // Track spawn count by hooking the semaphore's size(). Approximation.
      spawnsBefore = semaphore.size();
      // End of the `tickOpen` synchronous turn: everything above ran in the
      // one `setInterval` fire; the `await` below yields. With the folder-head
      // reads now async, this synchronous head no longer includes the git burst.
      recordTurn("tickOpen", tickOpenStart);
      // Ordering guard: every `git_head_update` for this tick completes before
      // the openspec fan-out begins, preserving per-cwd git-head-before-openspec
      // ordering. See change: attribute-openspec-poll-eventloop-stalls.
      await folderHeadDone;
      await Promise.all(dirs.map((cwd) => new Promise<void>((resolve) => {
        const delay = phaseOffsetMs(cwd, cfg.jitterSeconds);
        const timer = setTimeout(async () => {
          scheduledPhaseTimers.delete(timer);
          // `dirPollPre` = this `setTimeout` fire's synchronous prefix, INCLUDING
          // `pollOne`'s synchronous run before the worker `await` (root
          // `statMtimeOr` + list-signal `effectiveMtimeOr` stat-fan). We call
          // `pollDirectoryGated(cwd)` to kick off that synchronous prefix, then
          // record BEFORE awaiting so we never time across the await.
          const dirPollPreStart = performance.now();
          try {
            const prevCache = caches.get(cwd);
            const prevJson = prevCache?.serialized ?? (prevCache?.data ? JSON.stringify(prevCache.data) : undefined);
            const nextPromise = pollDirectoryGated(cwd);
            recordTurn("dirPollPre", dirPollPreStart);
            const next = await nextPromise;
            // `dirPollPost` = the continuation after the worker resolves:
            // `nextJson` compare + `JSON.stringify` fallback + broadcast.
            const dirPollPostStart = performance.now();
            const nextSerialized = caches.get(cwd)?.serialized;
            const nextJson = nextSerialized ?? JSON.stringify(next);
            // See change: emit-openspec-pending-from-poll — clear the spinner
            // even when the final JSON equals the prior cache.
            const pendingWasEmitted = pendingEmittedCwds.delete(cwd);
            if (nextJson !== prevJson || pendingWasEmitted) onChangeCallback?.(cwd, next, nextSerialized);
            recordTurn("dirPollPost", dirPollPostStart);
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
    cancelLoad,

    getOpenSpecData(cwd: string): OpenSpecData | undefined {
      return caches.get(cwd)?.data;
    },

    invalidateOpenSpecSignatureCache,

    refreshOpenSpec,
    pollDirectoryGated,

    getPiResources(cwd: string): PiResourcesResult | undefined {
      return piResourcesCache.get(cwd);
    },

    async refreshPiResources(cwd: string): Promise<PiResourcesResult> {
      return refreshPiResourcesInternal(cwd);
    },

    startPolling(
      onChange: (cwd: string, data: OpenSpecData, serialized?: string) => void,
      onFolderHead?: (msg: BrowserGitHeadUpdateMessage) => void,
    ) {
      onChangeCallback = onChange;
      // Construct the folder-HEAD poll now that the broadcast callback is
      // known. The poll's diff cache lives for the polling lifetime.
      // See change: refresh-folder-header-branch.
      if (onFolderHead) {
        folderHeadPoll = createFolderHeadPoll({ broadcast: onFolderHead, readHead: options.folderHeadReadHead });
        // Run an immediate folder-HEAD tick so the first paint reflects
        // current HEADs without waiting a full poll interval.
        void tickFolderHeads().catch((err) => { console.warn("[folder-head] initial tick failed:", err); });
      }
      // Lazy worker pool spawn happens on first request from `ensureWorkerPool()`.
      installTimers();
    },

    stopPolling() {
      stopTimers();
      onChangeCallback = null;
      // Tear down every per-cwd fs.watch so the process can exit cleanly.
      // See change: fix-openspec-taskcheck-delay.
      try { changeWatcher.detachAll(); } catch { /* best-effort */ }
      attachedWatcherCwds.clear();
      // Tear down folder-HEAD watchers + poll state. See change:
      // refresh-folder-header-branch.
      try { folderHeadWatcher.detachAll(); } catch { /* best-effort */ }
      attachedFolderHeadCwds.clear();
      if (folderHeadEntryTimer) { clearTimeout(folderHeadEntryTimer); folderHeadEntryTimer = null; }
      previousFolderHeadKeys = new Set();
      folderHeadPoll = null;
      // Terminate the OpenSpec poll worker pool (best-effort — callers that
      // restart polling will respawn it lazily). See change:
      // offload-openspec-poll-to-worker.
      if (workerPool) {
        const p = workerPool;
        workerPool = null;
        void p.dispose().catch(() => { /* ignore shutdown errors */ });
      }
      // Terminate the session-load worker pool too (respawns lazily if polling
      // restarts). See change: offload-session-events-load-to-worker.
      if (loadWorkerPool) {
        const lp = loadWorkerPool;
        loadWorkerPool = null;
        void lp.dispose().catch(() => { /* ignore shutdown errors */ });
      }
    },

    reconfigurePolling(newCfg: OpenSpecPollConfig) {
      const oldInterval = cfg.pollIntervalSeconds;
      const wasEnabled = cfg.enabled;
      const prev = cfg;
      cfg = { ...newCfg };
      semaphore.setMax(cfg.maxConcurrentSpawns);
      // Worker-pool sizing tracks maxConcurrentSpawns. Reconfigure by
      // tearing down the pool; it respawns lazily with the new size on the
      // next request. See change: offload-openspec-poll-to-worker.
      if (workerPool) {
        const p = workerPool;
        workerPool = null;
        void p.dispose().catch(() => { /* ignore */ });
      }
      // Only re-install timers if they were running and the interval actually changed.
      if (pollTimer && oldInterval !== cfg.pollIntervalSeconds) {
        installTimers();
      }

      // ── Readiness re-broadcast (add-openspec-init-affordances) ──
      // Re-broadcast ONLY when a readiness-affecting key changed, so
      // poll-tuning writes (interval, concurrency, jitter, worker flag) do
      // not trigger a readiness storm (E24). Membership changes re-broadcast
      // only the cwds whose membership changed (E25); `enabled` /
      // `offerInitialization` are global and re-broadcast every cached cwd.
      const optOutKeys = (dirs: string[]): string[] => {
        const platform = inferPlatform(dirs.length > 0 ? dirs : [process.cwd()]);
        return dirs.map((d) => pathKey(d, platform)).sort();
      };
      const readinessKey = (c: OpenSpecPollConfig): string =>
        JSON.stringify({ e: c.enabled, o: c.offerInitialization, d: optOutKeys(c.optOutDirectories) });
      const prevKey = readinessKey(prev);
      const nextKey = readinessKey(cfg);

      // On the `true → false` transition, clear every per-cwd `OpenSpecData`
      // cache and notify the broadcast channel so connected browsers converge
      // to the disabled-state shape — which now carries readiness GLOBAL_OFF
      // explicitly (E26). The `false → true` transition falls through to the
      // global-flip broadcast below; the next regular poll tick repopulates
      // caches with authoritative data. See changes:
      // auto-hide-empty-session-subcards, add-openspec-init-affordances.
      if (wasEnabled !== false && cfg.enabled === false) {
        const cleared = clearedDisabledPayload();
        for (const [cwd, cache] of caches.entries()) {
          cache.data = cleared;
          caches.set(cwd, cache);
          try {
            onChangeCallback?.(cwd, cleared);
          } catch (err) {
            console.warn(`[openspec-poll] onChange after disable failed for ${cwd}:`, err);
          }
        }
        return;
      }

      if (prevKey === nextKey) return;

      const rebroadcast = (cwds: string[]): void => {
        for (const cwd of cwds) {
          const cache = caches.get(cwd);
          if (!cache?.data) continue;
          // Recompute readiness synchronously against the NEW config. The
          // signature check uses the last resolved value (never spawns here);
          // a STALE correction arrives on the next tick.
          const d = cache.data;
          const readiness = deriveOpenSpecReadiness(
            {
              enabled: cfg.enabled !== false,
              optedOut: isOptedOutCwd(cwd),
              pending: d.pending === true,
              hasOpenspecDir: d.hasOpenspecDir === true,
              initialized: d.initialized === true,
              hasOpenSpecSkills: d.hasOpenSpecSkills,
              recordedSignature: preferencesStore.getOpenSpecUpdateSignature?.(cwd) as string | undefined,
              currentSignature: sigMemo?.resolved,
            },
            d,
          );
          const payload: OpenSpecData = { ...d, readiness };
          cache.data = payload;
          caches.set(cwd, cache);
          try {
            onChangeCallback?.(cwd, payload);
          } catch (err) {
            console.warn(`[openspec-poll] onChange after reconfigure failed for ${cwd}:`, err);
          }
        }
      };

      const globalFlip =
        prev.enabled !== cfg.enabled || prev.offerInitialization !== cfg.offerInitialization;
      if (globalFlip) {
        rebroadcast([...caches.keys()]);
      } else {
        // optOut membership diff — broadcast only the changed cwds (E25).
        const before = new Set(optOutKeys(prev.optOutDirectories));
        const after = new Set(optOutKeys(cfg.optOutDirectories));
        const platformDirs = [...before, ...after];
        const platform = inferPlatform(platformDirs.length > 0 ? platformDirs : [process.cwd()]);
        const changed = new Set<string>();
        for (const d of prev.optOutDirectories) if (!after.has(pathKey(d, platform))) changed.add(d);
        for (const d of cfg.optOutDirectories) if (!before.has(pathKey(d, platform))) changed.add(d);
        rebroadcast([...changed]);
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
      // A pinned/added directory enters the folder-HEAD key set with no session
      // at all — refresh it rather than waiting a full poll interval. For a
      // brand-new session cwd this is the SECOND trigger (the `session_register`
      // handler already fired one); the debounce collapses the pair, so the
      // duplicate costs nothing and neither call site depends on the other.
      // See change: fix-folder-header-worktree-branch-leak.
      refreshFolderHeadsForEnteringKeys();
      return { sessions, openspecData };
    },

    folderHeadSnapshot(): Array<{ cwd: string; branch: string | null }> {
      return folderHeadPoll?.snapshot() ?? [];
    },

    refreshFolderHeadsForEnteringKeys,
  };
}
