/**
 * Fixed-size `worker_threads` pool for session-event hydration.
 *
 * Modeled on `openspec-poll-worker-pool.ts` (copied, not extracted — the
 * generic pool is deferred to the third consumer per rule-of-three). Two
 * differences drive the design:
 *
 *   1. Output volume is large (multi-MB `events` arrays). We accept the
 *      structured-clone cost across the boundary; it is still cheaper than
 *      blocking the loop for the whole parse.
 *   2. Jobs are cancellable. `cancel(jobId)` drops a queued job, or abandons
 *      an in-flight job (its result is discarded on arrival). A plain cancel
 *      NEVER terminates the worker — only timeout/crash does.
 *
 * Fallbacks (resilience — never hard-depend on the worker):
 *   - `useWorker === false`                         → in-process for every request.
 *   - Worker entry URL unresolvable / spawn throws  → in-process for this pool lifecycle.
 *   - Worker emits `error` / `exit !== 0`           → terminate, fall back for that request, respawn lazily.
 *   - Per-request timeout                           → terminate worker, fall back for that request.
 *
 * The pool is owned by `DirectoryService` (lazy spawn on first load; disposed
 * on `stopPolling`).
 *
 * See change: offload-session-events-load-to-worker.
 */
import { Worker } from "node:worker_threads";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadAndReplay,
  type SessionLoadRequest,
  type SessionLoadResult,
} from "./session-load-worker.js";

export interface SessionLoadWorkerPoolOptions {
  /** Number of worker slots. Clamped to `[1, +∞)`. Caller passes `min(maxConcurrentSpawns, cpus)`. */
  size?: number;
  /** Per-request timeout in ms. Default 30_000 (see change task 1.1 rationale). */
  timeoutMs?: number;
  /** When `false`, every request runs in-process (no worker spawn). Default `true`. */
  useWorker?: boolean;
  /** Override the worker entry URL. Used by tests to force a spawn failure. */
  workerUrlOverride?: string;
}

/** Returned from `load()` so the caller can `cancel(jobId)` before it resolves. */
export interface SessionLoadDispatch {
  jobId: number;
  /** Always resolves — never rejects. Resolves `{success:false,error:"cancelled"}` if cancelled. */
  result: Promise<SessionLoadResult>;
}

export interface SessionLoadWorkerPool {
  load(req: Omit<SessionLoadRequest, "jobId">): SessionLoadDispatch;
  /** Drop a queued job or abandon an in-flight one. No-op for unknown/settled ids. */
  cancel(jobId: number): void;
  dispose(): Promise<void>;
  /** Test-only: number of in-flight worker requests. */
  inFlight(): number;
}

type Pending = {
  id: number;
  payload: SessionLoadRequest;
  resolve: (out: SessionLoadResult) => void;
  resolved: boolean;
  /** Set by `cancel()` — the eventual result is discarded, not delivered. */
  abandoned: boolean;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  /** -1 until dispatched to a worker slot. */
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
  /pi-dashboard|session-load/.test(process.env.DEBUG);

function defaultWorkerUrl(): string {
  // The worker entry is a sibling .ts module; jiti (inherited via
  // `execArgv: process.execArgv`) loads it transparently in the worker thread.
  const here = dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(here, "session-load-worker.ts")).href;
}

function cancelledResult(jobId: number): SessionLoadResult {
  return { jobId, success: false, events: [], error: "cancelled" };
}

export function createSessionLoadWorkerPool(
  opts: SessionLoadWorkerPoolOptions = {},
): SessionLoadWorkerPool {
  const size = Math.max(1, opts.size ?? 1);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const useWorker = opts.useWorker !== false;
  const workerUrl = opts.workerUrlOverride ?? defaultWorkerUrl();

  // Flip permanently when workers are globally unavailable for this pool
  // (e.g. bogus spawn URL on a constrained host) so we don't retry a
  // known-broken spawn per request.
  let workersDisabled = !useWorker;

  const slots: Slot[] = Array.from({ length: useWorker ? size : 0 }, () => ({
    worker: null,
    busy: false,
    dead: true, // lazy spawn
  }));

  // Every live job, keyed by id, so `cancel()` can find a job on any path
  // (queued, dispatched, or the in-process microtask).
  const jobs = new Map<number, Pending>();
  const queue: Pending[] = [];
  let nextId = 1;
  let disposed = false;

  function finish(p: Pending, out: SessionLoadResult): void {
    if (p.resolved) return;
    p.resolved = true;
    p.resolve(out);
  }

  function freeSlot(p: Pending): void {
    if (p.slotIndex >= 0) {
      const s = slots[p.slotIndex];
      if (s) s.busy = false;
    }
  }

  function spawnSlot(i: number): void {
    if (workersDisabled || disposed) return;
    try {
      const w = new Worker(new URL(workerUrl), {
        // Inherit `--import jiti-register.mjs` so the worker loads the .ts entry.
        execArgv: [...process.execArgv],
      });
      w.on("message", (msg: SessionLoadResult) => {
        const p = jobs.get(msg.jobId);
        if (!p) return; // already settled/disposed
        if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
        jobs.delete(p.id);
        freeSlot(p);
        if (!p.abandoned) finish(p, msg);
        drainQueue();
      });
      w.on("error", (err) => {
        if (DEBUG) console.warn(`[session-load-worker-pool] slot ${i} crashed:`, err);
        killSlot(i, /*fallbackAllPending*/ true);
      });
      w.on("exit", (code) => {
        if (code !== 0 && DEBUG) console.warn(`[session-load-worker-pool] slot ${i} exited code=${code}`);
        const s = slots[i];
        if (s && s.worker === w) { s.worker = null; s.dead = true; s.busy = false; }
      });
      slots[i] = { worker: w, busy: false, dead: false };
    } catch (err) {
      if (DEBUG) console.warn(`[session-load-worker-pool] slot ${i} spawn failed:`, err);
      workersDisabled = true; // permanent fallback for this pool lifecycle
    }
  }

  function killSlot(i: number, fallbackAllPending: boolean): void {
    const s = slots[i];
    if (!s) return;
    if (s.worker) { try { s.worker.terminate(); } catch { /* ignore */ } }
    s.worker = null;
    s.dead = true;
    s.busy = false;
    if (fallbackAllPending) {
      for (const p of Array.from(jobs.values())) {
        if (p.slotIndex === i) fallbackSettle(p);
      }
    }
  }

  /** In-process settle: run the parse+replay on the main thread (or resolve
   *  cancelled if the job was abandoned before we got here). */
  function fallbackSettle(p: Pending): void {
    if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
    jobs.delete(p.id);
    freeSlot(p);
    if (p.abandoned) {
      finish(p, cancelledResult(p.id));
    } else {
      finish(p, loadAndReplay(p.payload));
    }
    drainQueue();
  }

  function pickFreeSlot(): number {
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].busy) return i;
    }
    return -1;
  }

  function drainQueue(): void {
    while (queue.length > 0) {
      const idx = workersDisabled ? -1 : pickFreeSlot();
      if (idx === -1) {
        if (workersDisabled) { fallbackSettle(queue.shift()!); continue; }
        return; // wait for a slot
      }
      dispatch(queue.shift()!, idx);
    }
  }

  function dispatch(p: Pending, slotIndex: number): void {
    if (workersDisabled || disposed) { fallbackSettle(p); return; }
    if (p.abandoned) { fallbackSettle(p); return; } // resolves cancelled
    const slot = slots[slotIndex];
    if (slot.dead || slot.worker === null) spawnSlot(slotIndex);
    if (workersDisabled || !slots[slotIndex].worker) { fallbackSettle(p); return; }
    p.slotIndex = slotIndex;
    slots[slotIndex].busy = true;
    p.timeoutHandle = setTimeout(() => {
      if (DEBUG) console.warn(`[session-load-worker-pool] timeout for ${p.payload.sessionId} (${timeoutMs}ms)`);
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      fallbackSettle(p);
    }, timeoutMs);
    try {
      slots[slotIndex].worker!.postMessage(p.payload);
    } catch (err) {
      if (DEBUG) console.warn(`[session-load-worker-pool] postMessage threw for ${p.payload.sessionId}:`, err);
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      fallbackSettle(p);
    }
  }

  function load(req: Omit<SessionLoadRequest, "jobId">): SessionLoadDispatch {
    const id = nextId++;
    const payload: SessionLoadRequest = { ...req, jobId: id };
    let resolveOuter!: (out: SessionLoadResult) => void;
    const result = new Promise<SessionLoadResult>((r) => { resolveOuter = r; });
    const p: Pending = {
      id,
      payload,
      resolve: resolveOuter,
      resolved: false,
      abandoned: false,
      timeoutHandle: null,
      slotIndex: -1,
    };
    jobs.set(id, p);

    if (disposed || workersDisabled) {
      // In-process path. Defer to a microtask so a synchronous cancel() can
      // still drop the job before its events are computed.
      Promise.resolve().then(() => fallbackSettle(p));
      return { jobId: id, result };
    }
    const idx = pickFreeSlot();
    if (idx === -1) queue.push(p);
    else dispatch(p, idx);
    return { jobId: id, result };
  }

  function cancel(jobId: number): void {
    const p = jobs.get(jobId);
    if (!p || p.abandoned || p.resolved) return;
    p.abandoned = true;
    const qIdx = queue.indexOf(p);
    if (qIdx >= 0) {
      // Queued: drop it and resolve cancelled now.
      queue.splice(qIdx, 1);
      jobs.delete(p.id);
      finish(p, cancelledResult(p.id));
      return;
    }
    if (p.slotIndex >= 0) {
      // In-flight on a worker: resolve cancelled now; the worker is left
      // running and its eventual result is discarded on arrival (the message
      // handler frees the slot). Do NOT terminate the worker for a cancel.
      if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
      finish(p, cancelledResult(p.id));
      return;
    }
    // Otherwise it's a not-yet-run in-process microtask job: leave the
    // `abandoned` flag set; `fallbackSettle` will resolve cancelled.
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    // Drain queued requests in-process so callers don't hang on shutdown.
    for (const p of queue.splice(0, queue.length)) fallbackSettle(p);
    await Promise.all(slots.map(async (s) => {
      if (s.worker) { try { await s.worker.terminate(); } catch { /* ignore */ } }
      s.worker = null;
      s.dead = true;
      s.busy = false;
    }));
  }

  function inFlight(): number {
    let n = 0;
    for (const p of jobs.values()) if (p.slotIndex >= 0) n++;
    return n;
  }

  return { load, cancel, dispose, inFlight };
}
