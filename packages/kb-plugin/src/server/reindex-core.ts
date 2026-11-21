/**
 * The indexing core of a dashboard reindex job: `indexInPlace` / `firstIndex`, moved verbatim out of
 * `kb-routes.ts` so ONE implementation runs on either host — the `reindex-worker.mjs` thread (default) or
 * the main thread (kill-switch `PI_DASHBOARD_KB_REINDEX_WORKER=0`, or a worker load failure).
 *
 * Plain-data in / out (structured-cloneable): the sources `reindexAll` already resolved on the main
 * thread, the main-side `gate` string, and the job `mode`. Nothing in here touches the Fastify layer.
 *
 * The only behaviour that differs from the pre-move bodies is ABORT handling: a cancelled run
 * (`signal.aborted` / `KbIndexAborted`) is rethrown BEFORE an outcome is recorded — it is neither a
 * per-source error nor a success — and the aborted source's `stampSource` and the `stampPass` are skipped
 * (a source already completed and stamped keeps its stamp).
 *
 * See change: throttle-kb-reindex (D3).
 */

import { existsSync } from "node:fs";
import {
  beginForcedSource,
  indexOptionsFromConfig,
  indexOptionsHash,
  indexSource,
  KbIndexAborted,
  loadConfig,
  runIndexAtomic,
  SqliteFtsStore,
  seedOptionsFromConfig,
  sourceGateIsStale,
  stampPass,
  stampSource,
} from "@blackbelt-technology/pi-dashboard-kb";
import type { KbReindexResult, KbSourceOutcome } from "../shared/kb-plugin-types.js";

/** One resolved source, as plain data. `started` (epoch ms) feeds the per-source `ms=` log field. */
export interface ReindexCoreSource {
  ref: string;
  kind: string;
  id: string;
  dir: string;
  revision?: string;
  started: number;
}
export interface ReindexCoreInput {
  cwd: string;
  /** The resolved index db path (main resolved it; the runner uses it to clean a killed first index's temp). */
  dbPath: string;
  sources: ReindexCoreSource[];
  /** `in-place`: the db exists, index each source into it; `first`: build a temp file and install it atomically. */
  mode: "in-place" | "first";
  /** `indexOptionsHash` of the config main resolved the sources from; the core refuses to run under another. */
  gate: string;
}
export interface ReindexProgress {
  root: string;
  done: number;
  total: number;
}
export type ReindexLog = { info(m: string): void; warn(m: string): void };
export interface ReindexCoreHooks {
  log?: ReindexLog;
  signal?: AbortSignal;
  onProgress?: (p: ReindexProgress) => void;
}

/** Minimum spacing of worker→main progress messages. */
export const PROGRESS_MIN_INTERVAL_MS = 250;

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A cancelled run — by the abort signal, or by the indexer's own `KbIndexAborted`. */
const isAbort = (e: unknown, signal: AbortSignal | undefined): boolean => signal?.aborted === true || e instanceof KbIndexAborted;

const okOutcome = (x: ReindexCoreSource): KbSourceOutcome => ({ ref: x.ref, status: "ok", ...(x.revision ? { revision: x.revision } : {}), at: Date.now() });

/** Throttle a progress sink: the first report goes through, later ones at most once per `intervalMs`.
 *  The final totals travel in the job result, so a dropped intermediate report loses nothing. */
export function coalesceProgress(post: (p: ReindexProgress) => void, intervalMs = PROGRESS_MIN_INTERVAL_MS): (p: ReindexProgress) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (p) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    post(p);
  };
}

/** First index: all-or-nothing through the atomic path. Nothing on disk → nothing to build, no file. */
async function firstIndex(cfg: ReturnType<typeof loadConfig>, sources: ReindexCoreSource[], hooks: ReindexCoreHooks): Promise<KbReindexResult> {
  const { log, signal } = hooks;
  const outcomes: KbSourceOutcome[] = [];
  if (!sources.some((x) => existsSync(x.dir))) return { changed: 0, chunks: 0, outcomes };
  let r: Awaited<ReturnType<typeof runIndexAtomic>>;
  try {
    r = await runIndexAtomic({
      dbPath: cfg.dbAbsPath,
      sources: sources.map((x) => ({ id: x.id, dir: x.dir })),
      indexOpts: indexOptionsFromConfig(cfg, { signal, onProgress: hooks.onProgress }),
      gate: cfg,
      seed: seedOptionsFromConfig(cfg),
    });
  } catch (e) {
    if (isAbort(e, signal)) throw e; // cancelled, not failed: no error outcomes (the atomic path already unlinked its temp)
    // All-or-nothing: record every resolved source as failed so the per-source outcomes (and the
    // job's error summary) reflect THIS run rather than a stale earlier one.
    for (const x of sources) {
      outcomes.push({ ref: x.ref, status: "error", error: errMsg(e), at: Date.now() });
      log?.warn(`[kb-plugin] source failed ref=${x.ref} ms=${Date.now() - x.started}: ${errMsg(e)}`);
    }
    return { changed: 0, chunks: 0, outcomes };
  }
  for (const x of sources) {
    outcomes.push(okOutcome(x));
    log?.info(`[kb-plugin] source ok ref=${x.ref} kind=${x.kind} ms=${Date.now() - x.started}`);
  }
  return { changed: r.changed, chunks: r.counts.chunks, outcomes };
}

/** Existing database: per-source gate (force exactly the stale sources), stamp only ok non-missing ones. */
async function indexInPlace(cfg: ReturnType<typeof loadConfig>, sources: ReindexCoreSource[], hooks: ReindexCoreHooks): Promise<KbReindexResult> {
  const { log, signal } = hooks;
  const outcomes: KbSourceOutcome[] = [];
  const store = new SqliteFtsStore(cfg.dbAbsPath);
  store.init();
  try {
    let changed = 0;
    for (const x of sources) {
      try {
        const force = sourceGateIsStale(store, cfg, x.id);
        const stats = await indexSource(
          store,
          { root: x.id, dir: x.dir },
          indexOptionsFromConfig(cfg, { force, onFirstBatch: force ? beginForcedSource(store, x.id) : undefined, signal, onProgress: hooks.onProgress }),
        );
        if (!stats.missing) stampSource(store, cfg, x.id);
        changed += stats.changed;
        outcomes.push(okOutcome(x));
        log?.info(`[kb-plugin] source ok ref=${x.ref} kind=${x.kind} ms=${Date.now() - x.started}`);
      } catch (e) {
        if (isAbort(e, signal)) throw e; // cancelled, not failed: no outcome for this source, later sources never start, no stampPass
        outcomes.push({ ref: x.ref, status: "error", error: errMsg(e), at: Date.now() });
        log?.warn(`[kb-plugin] source failed ref=${x.ref} ms=${Date.now() - x.started}: ${errMsg(e)}`);
      }
    }
    stampPass(store, cfg);
    return { changed, chunks: store.counts().chunks, outcomes };
  } finally {
    store.close();
  }
}

/**
 * Index the already-resolved `input.sources`. Loads the folder's config itself and refuses to run when its
 * options hash differs from `input.gate` (the config was edited between main's resolve and this load —
 * indexing config A's sources under config B's gate would stamp the wrong gate), before opening any store.
 * Returns the per-source outcomes of THIS run only; `reindexAll` prepends the resolve-time outcomes.
 */
export async function runReindexCore(input: ReindexCoreInput, hooks: ReindexCoreHooks = {}): Promise<KbReindexResult> {
  const cfg = loadConfig(input.cwd);
  if (indexOptionsHash(cfg) !== input.gate) throw new Error("config changed during reindex");
  return input.mode === "first" ? firstIndex(cfg, input.sources, hooks) : indexInPlace(cfg, input.sources, hooks);
}
