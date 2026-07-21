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
import { Worker } from "node:worker_threads";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  deriveAndSerialize,
  type PollWorkerRequest,
  type PollWorkerResponse,
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
  dispose(): Promise<void>;
  /** Test-only: number of in-flight worker requests. */
  inFlight(): number;
}

type Pending = {
  id: number;
  payload: PollWorkerRequest;
  resolve: (out: PollWorkerResponse) => void;
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

function defaultWorkerUrl(): string {
  // The worker entry is a sibling .ts module; jiti (inherited via
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
        // Inherit `--import jiti-register.mjs` so the worker can load the
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
            console.warn(`[openspec-poll-worker-pool] worker error for ${p.payload.cwd}: ${msg.error}`);
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
    let out: PollWorkerResponse;
    try {
      out = deriveAndSerialize(p.payload);
    } catch (err) {
      // Last-resort: emit an empty payload so the broadcast pipeline doesn't
      // throw. Tests don't exercise this branch (derivation is pure +
      // try/catch-internal); kept as a defensive guard.
      const data = { initialized: false, changes: [], hasOpenspecDir: p.payload.hasOpenspecDir };
      out = {
        cwd: p.payload.cwd,
        data: data as any,
        serialized: JSON.stringify(data),
        stampMtimes: {},
        racyNames: [],
      };
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`[openspec-poll-worker-pool] in-process fallback threw for ${p.payload.cwd}:`, err);
      }
    }
    p.resolve(out);
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
        console.warn(`[openspec-poll-worker-pool] timeout for ${p.payload.cwd} (${timeoutMs}ms)`);
      }
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      fallbackSettle(p);
    }, timeoutMs);
    try {
      slots[slotIndex].worker!.postMessage({ id: p.id, payload: p.payload });
    } catch (err) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`[openspec-poll-worker-pool] postMessage threw for ${p.payload.cwd}:`, err);
      }
      killSlot(slotIndex, /*fallbackAllPending*/ false);
      fallbackSettle(p);
    }
  }

  // NB: named `processRequest`, not `process`, so it does not shadow Node's
  // global `process` (used for `process.execArgv` in `spawnSlot`).
  function processRequest(req: PollWorkerRequest): Promise<PollWorkerResponse> {
    if (disposed) return Promise.resolve(deriveAndSerialize(req));
    return new Promise<PollWorkerResponse>((resolveOuter) => {
      const p: Pending = {
        id: nextId++,
        payload: req,
        resolve: resolveOuter,
        timeoutHandle: null,
        slotIndex: -1,
      };
      if (workersDisabled) {
        // In-process path. Defer to microtask so callers can rely on async
        // semantics regardless of the path taken.
        Promise.resolve().then(() => fallbackSettle(p));
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

  return { process: processRequest, dispose, inFlight };
}
