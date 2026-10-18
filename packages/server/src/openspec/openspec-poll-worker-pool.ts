/**
 * Fixed-size `worker_threads` pool for the OpenSpec poll path.
 *
 * One worker per slot; each slot handles one request at a time. Requests
 * arriving with all slots busy queue FIFO. Per-request timeout terminates
 * the offending worker (it gets respawned lazily) and falls back to
 * in-process derivation so the tick never drops a broadcast.
 *
 * Fallbacks (resilience — never hard-depend on the worker):
 *   - `useWorker === false` (config flag)      → in-process for every request.
 *   - Worker entry URL unresolvable / spawn throws → in-process for every request (worker disabled for this pool lifecycle).
 *   - Worker emits `error` / `exit !== 0`      → terminate, fall back for that request, respawn lazily next request.
 *   - Per-request timeout                       → terminate worker, fall back for that request.
 *
 * The pool is owned by `DirectoryService`. `startPolling()` constructs it,
 * `stopPolling()` calls `dispose()`.
 *
 * See change: offload-openspec-poll-to-worker.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  buildFromStatusAll,
  deriveAndSerialize,
  type PollWorkerKind,
  type PollWorkerRequest,
  type PollWorkerResponse,
  type ProbeRequest,
  type ProbeResponse,
  probeTrackedPaths,
  type StatusAllBuildRequest,
  type StatusAllBuildResponse,
} from "./openspec-poll-worker.js";

export interface PollWorkerPoolOptions {
  /** Number of worker slots. Clamped to `[1, +∞)`. Caller should pass `Math.min(maxConcurrentSpawns, os.cpus().length)`. */
  size?: number;
  /** Per-request timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** When `false`, every request runs in-process (no worker spawn). Default `true`. */
  useWorker?: boolean;
  /** Override the worker entry URL. Used by tests to force a spawn failure. */
  workerUrlOverride?: string;
}

export interface PollWorkerPool {
  /** Derive + serialize for a single cwd. Always resolves with correct data — never rejects. */
  process(req: PollWorkerRequest): Promise<PollWorkerResponse>;
  /**
   * `status --all` tracked-path probe (async stats; runs in the worker, or as
   * bounded async I/O in-process when the worker is disabled/unhealthy).
   * See change: use-openspec-status-all.
   */
  probe(req: ProbeRequest): Promise<ProbeResponse>;
  /** `status --all` post-CLI build: classify, parse, count, re-probe, serialize. */
  build(req: StatusAllBuildRequest): Promise<StatusAllBuildResponse>;
  dispose(): Promise<void>;
  /** Test-only: number of in-flight worker requests. */
  inFlight(): number;
}

type PendingPayload = PollWorkerRequest | ProbeRequest | StatusAllBuildRequest;

type Pending = {
  id: number;
  kind: PollWorkerKind;
  payload: PendingPayload;
  /** Resolves the caller's promise. */
  resolve: (out: never) => void;
  /** Rejects it (`probe` / `build` only — `process` never rejects). */
  reject: (err: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  slotIndex: number;
};

type Slot = {
  worker: Worker | null;
  busy: boolean;
  /** Cleared when the worker is dead and the next request must respawn. */
  dead: boolean;
};

const DEBUG = typeof process !== "undefined" &&
  typeof process.env?.DEBUG === "string" &&
  /pi-dashboard|openspec-poll/.test(process.env.DEBUG);

/** Log label for a request. */
function labelOf(p: Pending): string {
  const payload = p.payload as { cwd?: string; openspecDir?: string };
  return payload.cwd ?? payload.openspecDir ?? "?";
}

/**
 * In-process `derive`. A throw yields an empty payload so the broadcast
 * pipeline doesn't throw (defensive: derivation is pure + try/catch-internal).
 */
function deriveInProcess(req: PollWorkerRequest): PollWorkerResponse {
  try {
    return deriveAndSerialize(req);
  } catch (err) {
    const data: OpenSpecData = { initialized: false, changes: [], hasOpenspecDir: req.hasOpenspecDir };
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn(`[openspec-poll-worker-pool] in-process fallback threw for ${req.cwd}:`, err);
    }
    return { cwd: req.cwd, data, serialized: JSON.stringify(data), stampMtimes: {}, racyNames: [] };
  }
}

/** In-process `probe` / `build` (async, bounded I/O). */
function runAsyncInProcess(kind: PollWorkerKind, payload: PendingPayload): Promise<unknown> {
  return kind === "probe"
    ? probeTrackedPaths(payload as ProbeRequest)
    : buildFromStatusAll(payload as StatusAllBuildRequest);
}

function defaultWorkerUrl(): string {
  // The worker entry is a sibling .ts module; the server's `--import` loader (inherited via
  // `execArgv: process.execArgv`) loads it transparently in the worker thread.
  const here = dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(here, "openspec-poll-worker.ts")).href;
}

export function createOpenSpecPollWorkerPool(opts: PollWorkerPoolOptions = {}): PollWorkerPool {
  const size = Math.max(1, opts.size ?? 1);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const useWorker = opts.useWorker !== false;
  const workerUrl = opts.workerUrlOverride ?? defaultWorkerUrl();

  // When workers are globally unavailable for this pool (e.g. spawn URL is
  // bogus on a constrained host), we flip this flag to permanently route
  // requests in-process. Avoids retrying a known-broken spawn per request.
  let workersDisabled = !useWorker;

  const slots: Slot[] = Array.from({ length: useWorker ? size : 0 }, () => ({
    worker: null,
    busy: false,
    dead: true, // lazy spawn
  }));

  const pending = new Map<number, Pending>();
  const queue: Pending[] = [];
  let nextId = 1;
  let disposed = false;

  function spawnSlot(i: number): void {
    if (workersDisabled || disposed) return;
    try {
      const w = new Worker(new URL(workerUrl), {
        // Inherit the server's `--import` loader so the worker can load the
        // .ts entry. Mirrors `packages/server/bin/pi-dashboard.mjs`.
        execArgv: [...process.execArgv],
      });
      w.on("message", (msg: { id: number; ok: boolean; response?: PollWorkerResponse; error?: string }) => {
        const p = pending.get(msg.id);
        if (!p) return;
        if (msg.ok && msg.response) {
          settle(p, msg.response);
        } else {
          if (DEBUG) {
            // eslint-disable-next-line no-console
            console.warn(`[openspec-poll-worker-pool] worker error for ${labelOf(p)}: ${msg.error}`);
          }
          fallbackSettle(p);
        }
      });
      w.on("error", (err) => {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(`[openspec-poll-worker-pool] slot ${i} crashed:`, err);
        }
        killSlot(i, /*fallbackAllPending*/ true);
      });
      w.on("exit", (code) => {
        if (code !== 0 && DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(`[openspec-poll-worker-pool] slot ${i} exited code=${code}`);
        }
        // Mark dead so the next dispatch respawns.
        const s = slots[i];
        if (s && s.worker === w) {
          s.worker = null;
          s.dead = true;
          s.busy = false;
        }
      });
      slots[i] = { worker: w, busy: false, dead: false };
    } catch (err) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`[openspec-poll-worker-pool] slot ${i} spawn failed:`, err);
      }
      // Permanent fallback for this pool lifecycle.
      workersDisabled = true;
    }
  }

  function killSlot(i: number, fallbackAllPending: boolean): void {
    const s = slots[i];
    if (!s) return;
    if (s.worker) {
      try { s.worker.terminate(); } catch { /* ignore */ }
    }
    s.worker = null;
    s.dead = true;
    s.busy = false;
    if (fallbackAllPending) {
      // Any pending request bound to this slot falls back in-process.
      for (const p of Array.from(pending.values())) {
        if (p.slotIndex === i) fallbackSettle(p);
      }
    }
  }

  function settle(p: Pending, response: PollWorkerResponse): void {
    if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
    pending.delete(p.id);
    const slot = slots[p.slotIndex];
    if (slot) slot.busy = false;
    p.resolve(response);
    drainQueue();
  }

  function fallbackSettle(p: Pending): void {
    if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
    pending.delete(p.id);
    const slot = slots[p.slotIndex];
    if (slot) slot.busy = false;
    if (p.kind === "derive") {
      p.resolve(deriveInProcess(p.payload as PollWorkerRequest) as never);
    } else {
      // `probe` / `build`: async in-process run (bounded async I/O). A failure
      // here is a real error for the caller (it treats it as a failed poll).
      runAsyncInProcess(p.kind, p.payload).then(p.resolve, p.reject);
    }
    drainQueue();
  }

  function pickFreeSlot(): number {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.busy) return i;
    }
    return -1;
  }

  function drainQueue(): void {
    while (queue.length > 0) {
      const idx = workersDisabled ? -1 : pickFreeSlot();
      if (idx === -1) {
        // No free slot. If workers are globally disabled, drain everything
        // in-process; otherwise wait for a slot to free up.
        if (workersDisabled) {
          const p = queue.shift()!;
          fallbackSettle(p);
          continue;
        }
        return;
      }
      const p = queue.shift()!;
      dispatch(p, idx);
    }
  }

  function dispatch(p: Pending, slotIndex: number): void {
    if (workersDisabled || disposed) {
      fallbackSettle(p);
      return;
    }
    const slot = slots[slotIndex];
    if (slot.dead || slot.worker === null) spawnSlot(slotIndex);
    if (workersDisabled || !slots[slotIndex].worker) {
      fallbackSettle(p);
      return;
    }
    p.slotIndex = slotIndex;
    slots[slotIndex].busy = true;
    pending.set(p.id, p);
    p.timeoutHandle = setTimeout(() => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`[openspec-poll-worker-pool] timeout for ${labelOf(p)} (${timeoutMs}ms)`);
      }
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      fallbackSettle(p);
    }, timeoutMs);
    try {
      slots[slotIndex].worker!.postMessage({ id: p.id, kind: p.kind, payload: p.payload });
    } catch (err) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`[openspec-poll-worker-pool] postMessage threw for ${labelOf(p)}:`, err);
      }
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      fallbackSettle(p);
    }
  }

  // NB: named `processRequest`, not `process`, so it does not shadow Node's
  // global `process` (used for `process.execArgv` in `spawnSlot`).
  function enqueue<T>(kind: PollWorkerKind, req: PendingPayload): Promise<T> {
    if (disposed) {
      return (kind === "derive"
        ? Promise.resolve(deriveAndSerialize(req as PollWorkerRequest))
        : runAsyncInProcess(kind, req)) as Promise<T>;
    }
    return new Promise<T>((resolveOuter, rejectOuter) => {
      const p: Pending = {
        id: nextId++,
        kind,
        payload: req,
        resolve: resolveOuter,
        reject: rejectOuter,
        timeoutHandle: null,
        slotIndex: -1,
      };
      if (workersDisabled) {
        // In-process path. Defer to microtask so callers can rely on async
        // semantics regardless of the path taken.
        // `fallbackSettle` try/catches its own derivation, so this handler is a
        // guard rather than an expected path — but this pool runs on worker
        // threads that plausibly do not reach the `cli.ts` crash-safety net, so
        // an escaping rejection would be invisible AND leave the caller
        // pending. Free the slot and log instead.
        // See change: cleanup-async-semantics-server-extension (design D1).
        Promise.resolve()
          .then(() => fallbackSettle(p))
          .catch((err: unknown) => {
            console.warn(`[openspec-poll-worker-pool] in-process settle failed for ${labelOf(p)}:`, err);
            pending.delete(p.id);
            const slot = slots[p.slotIndex];
            if (slot) slot.busy = false;
          });
        return;
      }
      const idx = pickFreeSlot();
      if (idx === -1) {
        queue.push(p);
      } else {
        dispatch(p, idx);
      }
    });
  }

  function processRequest(req: PollWorkerRequest): Promise<PollWorkerResponse> {
    return enqueue<PollWorkerResponse>("derive", req);
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    // Drain queued requests in-process so callers don't hang on shutdown.
    for (const p of queue.splice(0, queue.length)) fallbackSettle(p);
    // Terminate workers.
    await Promise.all(slots.map(async (s) => {
      if (s.worker) {
        try { await s.worker.terminate(); } catch { /* ignore */ }
      }
      s.worker = null;
      s.dead = true;
      s.busy = false;
    }));
  }

  function inFlight(): number {
    return pending.size;
  }

  return {
    process: processRequest,
    probe: (req) => enqueue<ProbeResponse>("probe", req),
    build: (req) => enqueue<StatusAllBuildResponse>("build", req),
    dispose,
    inFlight,
  };
}
