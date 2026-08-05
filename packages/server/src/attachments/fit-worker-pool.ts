/**
 * Fixed-size `worker_threads` pool for display-fitting image attachments.
 *
 * Modeled on `session-load-worker-pool.ts`, minus cancellation: a fit is
 * fire-and-forget from the ingest path's point of view (the message row is
 * already stored and broadcast), so there is no caller left to cancel it.
 *
 * NOTE (rule-of-three): this is the THIRD worker pool in the server
 * (`openspec-poll`, `session-load`, now `fit`). Extracting a generic pool is
 * tracked as a follow-up rather than done here, to keep this change scoped.
 *
 * Resilience — the fit path must NEVER be able to lose a message:
 *   - `useWorker === false`                        → in-process for every request.
 *   - Worker entry unresolvable / spawn throws     → in-process for this pool lifecycle.
 *   - Worker emits `error` / non-zero `exit`       → terminate, fall back, respawn lazily.
 *   - Per-request timeout                          → terminate worker, fall back.
 *
 * See change: fit-attachments-for-display (task 5.1, test-plan #X7 #X8).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { type FitRequest, type FitResponse, fitBlocks } from "./fit-worker.js";

export interface FitWorkerPoolOptions {
  /** Worker slots. Clamped to `[1, +∞)`. */
  size?: number;
  /** Per-request timeout in ms. Default 30_000 (a 10 MB fit measures <1 s). */
  timeoutMs?: number;
  /** When `false`, every request runs in-process. Default `true`. */
  useWorker?: boolean;
  /** Override the worker entry URL. Used by tests to force a spawn failure. */
  workerUrlOverride?: string;
}

export interface FitWorkerPool {
  /** Always resolves — a crash/timeout falls back to an in-process fit. */
  fit(req: Omit<FitRequest, "jobId">): Promise<FitResponse>;
  dispose(): Promise<void>;
  /** Test-only: number of in-flight worker requests. */
  inFlight(): number;
}

type Pending = {
  id: number;
  payload: FitRequest;
  resolve: (out: FitResponse) => void;
  resolved: boolean;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  slotIndex: number;
};

type Slot = { worker: Worker | null; busy: boolean; dead: boolean };

const DEBUG =
  typeof process !== "undefined" &&
  typeof process.env?.DEBUG === "string" &&
  /pi-dashboard|fit-worker/.test(process.env.DEBUG);

function defaultWorkerUrl(): string {
  // Sibling .ts entry; jiti (inherited via `execArgv`) loads it in the worker.
  const here = dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(here, "fit-worker.ts")).href;
}

export function createFitWorkerPool(opts: FitWorkerPoolOptions = {}): FitWorkerPool {
  const size = Math.max(1, opts.size ?? 1);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const useWorker = opts.useWorker !== false;
  const workerUrl = opts.workerUrlOverride ?? defaultWorkerUrl();

  let workersDisabled = !useWorker;
  const slots: Slot[] = Array.from({ length: useWorker ? size : 0 }, () => ({
    worker: null,
    busy: false,
    dead: true, // lazy spawn
  }));

  const jobs = new Map<number, Pending>();
  const queue: Pending[] = [];
  let nextId = 1;
  let disposed = false;

  function finish(p: Pending, out: FitResponse): void {
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
      const w = new Worker(new URL(workerUrl), { execArgv: [...process.execArgv] });
      w.on("message", (msg: FitResponse) => {
        const p = jobs.get(msg.jobId);
        if (!p) return;
        if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
        jobs.delete(p.id);
        freeSlot(p);
        finish(p, msg);
        drainQueue();
      });
      w.on("error", (err) => {
        if (DEBUG) console.warn(`[fit-worker-pool] slot ${i} crashed:`, err);
        killSlot(i, /*fallbackAllPending*/ true);
      });
      w.on("exit", (code) => {
        if (code !== 0 && DEBUG) console.warn(`[fit-worker-pool] slot ${i} exited code=${code}`);
        const s = slots[i];
        if (s && s.worker === w) { s.worker = null; s.dead = true; s.busy = false; }
      });
      slots[i] = { worker: w, busy: false, dead: false };
    } catch (err) {
      if (DEBUG) console.warn(`[fit-worker-pool] slot ${i} spawn failed:`, err);
      workersDisabled = true;
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
        if (p.slotIndex === i) void fallbackSettle(p);
      }
    }
  }

  // ── In-process fallback admission ──────────────────────────────────
  // A fallback fit runs jimp on the MAIN thread. Unbounded, a burst of pastes
  // (or a pool with workers disabled) runs N simultaneous decodes there — the
  // exact event-loop stall the worker pool exists to prevent, and a cheap DoS.
  // The fallback therefore honours the SAME slot count as the worker path;
  // excess fits wait their turn instead of piling onto the event loop.
  let fallbackActive = 0;
  const fallbackWaiters: Array<() => void> = [];

  async function acquireFallbackSlot(): Promise<void> {
    if (fallbackActive < size) {
      fallbackActive++;
      return;
    }
    await new Promise<void>((r) => fallbackWaiters.push(r));
    fallbackActive++;
  }

  function releaseFallbackSlot(): void {
    fallbackActive--;
    fallbackWaiters.shift()?.();
  }

  /** In-process settle: run the fit on the main thread, capped at `size`. */
  async function fallbackSettle(p: Pending): Promise<void> {
    if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
    freeSlot(p);
    // The job stays REGISTERED across the await below. Deregistering first made
    // it invisible to `dispose()`, so a job waiting on a fallback slot could
    // never be settled by shutdown and its caller's promise hung forever.
    await acquireFallbackSlot();
    try {
      // Shutdown began while we waited for a slot: abandon the work rather
      // than start a jimp decode nobody is left to receive.
      if (!disposed && !p.resolved) {
        finish(p, await fitBlocks(p.payload));
      }
    } finally {
      // Must release even if the fit throws, or the cap leaks a slot per
      // failure and eventually wedges every fallback fit forever.
      jobs.delete(p.id);
      releaseFallbackSlot();
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
        if (workersDisabled) { void fallbackSettle(queue.shift()!); continue; }
        return; // wait for a slot
      }
      dispatch(queue.shift()!, idx);
    }
  }

  function dispatch(p: Pending, slotIndex: number): void {
    if (workersDisabled || disposed) { void fallbackSettle(p); return; }
    const slot = slots[slotIndex];
    if (slot.dead || slot.worker === null) spawnSlot(slotIndex);
    if (workersDisabled || !slots[slotIndex].worker) { void fallbackSettle(p); return; }
    p.slotIndex = slotIndex;
    slots[slotIndex].busy = true;
    p.timeoutHandle = setTimeout(() => {
      if (DEBUG) console.warn(`[fit-worker-pool] timeout on job ${p.id} (${timeoutMs}ms)`);
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      void fallbackSettle(p);
    }, timeoutMs);
    try {
      slots[slotIndex].worker!.postMessage(p.payload);
    } catch (err) {
      if (DEBUG) console.warn(`[fit-worker-pool] postMessage threw on job ${p.id}:`, err);
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      void fallbackSettle(p);
    }
  }

  function fit(req: Omit<FitRequest, "jobId">): Promise<FitResponse> {
    const id = nextId++;
    const payload: FitRequest = { ...req, jobId: id };
    let resolveOuter!: (out: FitResponse) => void;
    const result = new Promise<FitResponse>((r) => { resolveOuter = r; });
    const p: Pending = {
      id,
      payload,
      resolve: resolveOuter,
      resolved: false,
      timeoutHandle: null,
      slotIndex: -1,
    };
    jobs.set(id, p);

    if (disposed || workersDisabled) {
      void fallbackSettle(p);
      return result;
    }
    const idx = pickFreeSlot();
    if (idx === -1) queue.push(p);
    else dispatch(p, idx);
    return result;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    // Disarm and settle EVERY registered job before terminating workers — both
    // the ones dispatched to a worker and the ones parked waiting for an
    // in-process fallback slot. Their timeouts would otherwise stay armed for
    // up to timeoutMs, keep the process alive, and then run a full in-process
    // fit during shutdown.
    for (const p of Array.from(jobs.values())) {
      if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
      jobs.delete(p.id);
      finish(p, { jobId: p.id, results: [] });
    }
    // Abandon the backlog rather than performing it. Routing these through
    // `fallbackSettle` started real jimp decodes on the main thread DURING
    // shutdown, and once the fallback became slot-capped they also queued
    // behind an in-flight fit — so a shutdown could sit waiting on work nobody
    // is left to receive. Every caller is answered with an empty result; a fit
    // is fire-and-forget by design, so an unfitted attachment simply resolves
    // to its failed state on the next load.
    for (const p of queue.splice(0, queue.length)) {
      if (p.timeoutHandle) { clearTimeout(p.timeoutHandle); p.timeoutHandle = null; }
      jobs.delete(p.id);
      finish(p, { jobId: p.id, results: [] });
    }
    await Promise.all(
      slots.map(async (s) => {
        if (s.worker) { try { await s.worker.terminate(); } catch { /* ignore */ } }
        s.worker = null;
        s.dead = true;
        s.busy = false;
      }),
    );
  }

  function inFlight(): number {
    let n = 0;
    for (const p of jobs.values()) if (p.slotIndex >= 0) n++;
    return n;
  }

  return { fit, dispose, inFlight };
}
