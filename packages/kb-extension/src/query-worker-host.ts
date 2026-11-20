// Session-side host of the kb query worker (change: bound-kb-proximity-search,
// design D6–D9). Runs `kb_search` / `kb_get` docs retrieval in ONE lazily
// started, reused worker thread per pi process (ref'd only while it has work), so the session
// thread (abort listener, bridge heartbeat, Stop) never blocks on it.
//
// Abort / deadline: return first, clean up after. The call resolves at once;
// the worker is abandoned (`dying`) and terminate()d fire-and-forget — a native
// SQLite statement cannot be interrupted and finishes in that thread. Other
// queued requests move to a fresh worker. At most DYING_CAP abandoned workers.
// Unavailable worker (load-failed, spawn-failed, start-timeout, kill switch,
// three crashes) → in-process fallback, warned once per process.
import { Worker } from "node:worker_threads";

export type QueryOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "cancelled" }
  | { kind: "timeout"; seconds: number }
  | { kind: "failed" };

export interface QueryWorkerHostOptions {
  /** Worker entry; default `./query-worker.mjs` beside this module. */
  workerUrl?: URL | string;
  /** Per-request deadline (ms) unless `run` passes one. */
  timeoutMs?: number;
  /** No `ready` within this → `start-timeout`. */
  startTimeoutMs?: number;
  /** `false` → always in-process. Default: `KB_QUERY_WORKER !== "0"`, read per call. */
  useWorker?: boolean;
  /** Host-initiated idle retire. */
  idleMs?: number;
  /** Wait before the single retry after a `spawn-failed` / `start-timeout`. */
  cooldownMs?: number;
  /** Passed to the worker (test workers read behaviour variants from it). */
  workerData?: unknown;
}

interface RunOptions<T> {
  signal?: AbortSignal;
  /** Today's synchronous path, used when the worker is unavailable. */
  inProcess: () => T;
  /** Overrides the host deadline for this call. */
  timeoutMs?: number;
  /** Names the tool in the deadline warning. */
  label?: string;
}

export interface QueryWorkerHost {
  run<T>(msg: { op: string; dbPath?: string; [k: string]: unknown }, opts: RunOptions<T>): Promise<QueryOutcome<T>>;
  /** Release the worker's connection to one database (worktree removal). */
  close(dbPath: string): void;
  /** Terminate every worker; the next call starts a new one. */
  shutdown(): void;
}

const QUERY_TIMEOUT_DEFAULT_MS = 60_000;
const QUERY_WORKER_START_TIMEOUT_MS = 10_000;
const QUERY_WORKER_IDLE_MS = 60_000;
const QUERY_WORKER_COOLDOWN_MS = 30_000;
const DYING_CAP = 2;
const MAX_CRASHES = 3;

type Req = {
  id: number;
  msg: { op: string; dbPath?: string; [k: string]: unknown };
  opts: RunOptions<unknown>;
  enqueuedAt: number;
  retried: boolean;
  settled: boolean;
  /** Deadline armed while cap-blocked: it runs from enqueue and survives dispatch. */
  enqueueDeadline?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (o: QueryOutcome<unknown>) => void;
  reject: (e: Error) => void;
  detach: () => void;
};
type Live = { worker: Worker; ready: boolean; inflight: Req | null; startTimer?: ReturnType<typeof setTimeout> };

export function createQueryWorkerHost(o: QueryWorkerHostOptions = {}): QueryWorkerHost {
  const workerUrl = o.workerUrl ?? new URL("./query-worker.mjs", import.meta.url);
  const startTimeoutMs = o.startTimeoutMs ?? QUERY_WORKER_START_TIMEOUT_MS;
  const idleMs = o.idleMs ?? QUERY_WORKER_IDLE_MS;
  const cooldownMs = o.cooldownMs ?? QUERY_WORKER_COOLDOWN_MS;

  let live: Live | null = null;
  const queue: Req[] = [];
  const dying = new Set<Worker>();
  let disabled: string | null = null;
  let startFailures = 0;
  let cooldownUntil = 0;
  let crashes = 0;
  let warned = false;
  let nextId = 1;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const warnFallback = (reason: string): void => {
    if (warned) return;
    warned = true;
    console.warn(`[kb] query worker unavailable (${reason}); kb_search/kb_get retrieval runs in-process — Stop cannot interrupt it`);
  };
  const timeoutOf = (r: Req) => r.opts.timeoutMs ?? o.timeoutMs ?? QUERY_TIMEOUT_DEFAULT_MS;

  const settle = (r: Req, out: QueryOutcome<unknown> | Error): void => {
    if (r.settled) return;
    r.settled = true;
    if (r.timer) clearTimeout(r.timer);
    r.detach();
    if (out instanceof Error) r.reject(out);
    else r.resolve(out);
  };
  const runInProcess = (r: Req): void => {
    try {
      settle(r, { kind: "ok", value: r.opts.inProcess() });
    } catch (e) {
      settle(r, e instanceof Error ? e : new Error(String(e)));
    }
  };
  const drainInProcess = (): void => {
    for (const r of queue.splice(0)) runInProcess(r);
  };

  /** Detach the live worker and terminate it fire-and-forget. Its exit is expected. */
  const abandon = (l: Live): void => {
    if (l.startTimer) clearTimeout(l.startTimer);
    if (live === l) {
      live = null;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    dying.add(l.worker);
    l.worker.unref(); // an abandoned native statement must never keep the process alive
    l.worker.terminate().catch(() => {});
  };

  const disable = (reason: string): void => {
    disabled = reason;
    warnFallback(reason);
  };

  /** A start attempt failed. `l` = a still-running worker to abandon (absent
   *  when it never spawned or already exited). */
  const startFailed = (l: Live | null, reason: string, permanent: boolean): void => {
    if (l) abandon(l);
    startFailures++;
    if (permanent || startFailures >= 2) disable(reason);
    else {
      cooldownUntil = Date.now() + cooldownMs;
      warnFallback(reason);
    }
    drainInProcess();
  };

  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (!live?.ready || live.inflight || queue.length) return;
    const l = live;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (live === l && !l.inflight && !queue.length) abandon(l);
    }, idleMs);
    idleTimer.unref?.();
  };

  const expire = (r: Req, kind: "cancelled" | "timeout"): void => {
    if (r.settled) return;
    const qi = queue.indexOf(r);
    if (qi >= 0) queue.splice(qi, 1);
    const seconds = Math.round(timeoutOf(r) / 1000);
    settle(r, kind === "timeout" ? { kind, seconds } : { kind });
    if (kind === "timeout") console.warn(`[kb] query timed out after ${seconds}s: ${r.opts.label ?? "kb"} ${r.msg.op} ${r.msg.dbPath ?? ""}`.trimEnd());
    if (live?.inflight === r) {
      live.inflight = null;
      abandon(live);
    } else if (live && !live.ready && !queue.length) {
      // nobody is waiting for the starting worker any more
      abandon(live);
    }
    pump();
  };

  const dispatch = (l: Live, r: Req): void => {
    try {
      l.worker.postMessage({ ...r.msg, id: r.id });
    } catch (e) {
      // not cloneable: an op error, the worker never saw it
      settle(r, e instanceof Error ? e : new Error(String(e)));
      return;
    }
    l.inflight = r;
    if (!r.enqueueDeadline) {
      if (r.timer) clearTimeout(r.timer);
      r.timer = setTimeout(() => expire(r, "timeout"), timeoutOf(r));
    }
  };

  const onExit = (l: Live, w: Worker): void => {
    if (dying.delete(w)) {
      pump();
      return;
    }
    if (live !== l) return;
    live = null;
    if (l.startTimer) clearTimeout(l.startTimer);
    if (!l.ready) {
      startFailed(null, "spawn-failed", false);
      return;
    }
    // crash after ready
    crashes++;
    const r = l.inflight;
    l.inflight = null;
    if (r && !r.settled) {
      if (r.timer) clearTimeout(r.timer);
      r.timer = undefined;
      r.enqueueDeadline = false; // the retry gets a fresh deadline at its own dispatch
      if (r.retried) settle(r, { kind: "failed" });
      else {
        r.retried = true;
        queue.unshift(r);
      }
    }
    if (crashes >= MAX_CRASHES) {
      disable(`query worker crashed ${crashes} times`);
      if (r && queue[0] === r) {
        queue.shift();
        settle(r, { kind: "failed" }); // never re-run the crashing input on the session thread
      }
      drainInProcess();
      return;
    }
    pump();
  };

  const spawn = (): void => {
    let w: Worker;
    try {
      w = new Worker(workerUrl, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 }, workerData: o.workerData });
    } catch {
      startFailed(null, "spawn-failed", false);
      return;
    }
    const l: Live = { worker: w, ready: false, inflight: null };
    live = l;
    l.startTimer = setTimeout(() => {
      if (live === l && !l.ready) startFailed(l, "start-timeout", false);
    }, startTimeoutMs);
    l.startTimer.unref?.();
    w.on("message", (m: { kind?: string; id?: number; value?: unknown; message?: string }) => {
      if (live !== l) return; // abandoned: late replies are discarded
      if (m?.kind === "ready") {
        if (l.ready) return;
        l.ready = true;
        startFailures = 0; // the retry budget is per failed start, not per process
        if (l.startTimer) clearTimeout(l.startTimer);
        pump();
      } else if (m?.kind === "load-failed") {
        startFailed(l, `load-failed: ${m.message ?? "unknown"}`, true);
      } else if ((m?.kind === "result" || m?.kind === "error") && l.inflight && l.inflight.id === m.id) {
        const r = l.inflight;
        l.inflight = null;
        settle(r, m.kind === "result" ? { kind: "ok", value: m.value } : new Error(m.message ?? "kb query failed"));
        pump();
      }
    });
    w.on("error", () => { /* the exit event that follows handles it */ });
    w.on("exit", () => onExit(l, w));
    syncRef(); // after the listeners: attaching a "message" listener re-refs the port
  };

  /** The live worker keeps the process alive only while it has work (in flight
   *  or queued); idle, it never does. */
  function syncRef(): void {
    if (!live) return;
    if (live.inflight || queue.length) live.worker.ref();
    else live.worker.unref();
  }

  function pump(): void {
    if (disabled) {
      drainInProcess();
      return;
    }
    if (live) {
      while (live.ready && !live.inflight && queue.length) dispatch(live, queue.shift()!);
      syncRef();
      armIdle();
      return;
    }
    if (!queue.length) return;
    if (Date.now() < cooldownUntil) {
      drainInProcess();
      return;
    }
    if (dying.size >= DYING_CAP) {
      // Cap-blocked: wait for a dying exit; the deadline runs from enqueue.
      for (const r of queue) {
        if (r.enqueueDeadline) continue;
        if (r.timer) clearTimeout(r.timer);
        r.enqueueDeadline = true;
        r.timer = setTimeout(() => expire(r, "timeout"), Math.max(0, r.enqueuedAt + timeoutOf(r) - Date.now()));
      }
      return;
    }
    spawn();
  }

  return {
    run<T>(msg: { op: string; dbPath?: string; [k: string]: unknown }, opts: RunOptions<T>): Promise<QueryOutcome<T>> {
      if (opts.signal?.aborted) return Promise.resolve({ kind: "cancelled" });
      return new Promise<QueryOutcome<T>>((resolve, reject) => {
        const r: Req = {
          id: nextId++,
          msg,
          opts: opts as RunOptions<unknown>,
          enqueuedAt: Date.now(),
          retried: false,
          settled: false,
          resolve: resolve as (o: QueryOutcome<unknown>) => void,
          reject,
          detach: () => {},
        };
        const useWorker = o.useWorker ?? process.env.KB_QUERY_WORKER !== "0";
        if (!useWorker) {
          warnFallback("disabled");
          runInProcess(r);
          return;
        }
        if (disabled || Date.now() < cooldownUntil) {
          if (disabled) warnFallback(disabled);
          runInProcess(r);
          return;
        }
        if (opts.signal) {
          const onAbort = () => expire(r, "cancelled");
          opts.signal.addEventListener("abort", onAbort, { once: true });
          r.detach = () => opts.signal?.removeEventListener("abort", onAbort);
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        queue.push(r);
        pump();
      });
    },
    close(dbPath: string): void {
      live?.worker.postMessage({ op: "close", dbPath });
    },
    shutdown(): void {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      for (const r of queue.splice(0)) settle(r, { kind: "cancelled" });
      if (live) {
        const l = live;
        if (l.inflight) settle(l.inflight, { kind: "cancelled" });
        l.inflight = null;
        abandon(l);
      }
    },
  };
}

let singleton: QueryWorkerHost | null = null;
/** The process-wide host (lazy). */
export function queryWorkerHost(): QueryWorkerHost {
  singleton ??= createQueryWorkerHost();
  return singleton;
}
/** Swap the process-wide host (tests, embedding); returns the previous one. */
export function setQueryWorkerHost(h: QueryWorkerHost | null): QueryWorkerHost | null {
  const prev = singleton;
  singleton = h;
  return prev;
}
