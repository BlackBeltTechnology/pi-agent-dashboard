/**
 * Host of the kb reindex worker thread (design D3, change: throttle-kb-reindex). `reindexAll` resolves the
 * sources and waits out another process's first index on the main thread, then hands a plain-data job to
 * `run()`, which executes the indexing core on ONE worker per folder — or on the main thread when the
 * kill-switch is set or the worker fails to load.
 *
 * Lifecycle (host shape follows packages/kb-extension/src/query-worker-host.ts, injectable `workerFactory`
 * like packages/server/src/auth/credential-key.ts):
 *  - worker → main messages: `ready` | `load-failed` | `progress` | `log` | `result` | `error` | `cancelled`;
 *    main → worker: `cancel`.
 *  - load failure BEFORE `ready` (a `load-failed` message, an uncaught error, an exit) → that job runs the
 *    same core in-process with a warning (G4); the next job tries the worker again.
 *  - crash / OOM AFTER `ready` → the job rejects; the server survives.
 *  - abort signal → `cancel` message, then `terminate()` after `graceMs` (5 s); `shutdown()` terminates at once.
 *  - after any NON-graceful end of a `first`-mode worker (terminate, crash, OOM) the runner unlinks
 *    `<db>.tmp-<pid>` + `-wal`/`-shm`: a worker shares the server's PID, so `sweepOrphanTemps` /
 *    `isFirstIndexLive` (which skip the own PID) would never reclaim it.
 *
 * One structured line per job is logged on settle (`mode`, outcome, …).
 */

import { rmSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type { KbReindexResult } from "../shared/kb-plugin-types.js";
import { errMsg, type ReindexCoreHooks, type ReindexCoreInput, runReindexCore } from "./reindex-core.js";

/** Grace between the `cancel` message and `terminate()`. */
export const REINDEX_CANCEL_GRACE_MS = 5000;
const KILL_SWITCH = "PI_DASHBOARD_KB_REINDEX_WORKER";

/** The slice of `worker_threads.Worker` the runner uses (tests inject an EventEmitter stand-in). */
export interface ReindexWorkerLike {
  on(event: "message", cb: (msg: unknown) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "exit", cb: (code: number) => void): unknown;
  off(event: "message", cb: (msg: unknown) => void): unknown;
  off(event: "error", cb: (err: Error) => void): unknown;
  off(event: "exit", cb: (code: number) => void): unknown;
  postMessage(msg: unknown): void;
  terminate(): Promise<number | undefined>;
}

export interface ReindexRunnerOptions {
  /** Worker entry; default `./reindex-worker.mjs` beside this module. */
  workerUrl?: URL | string;
  /** Spawns the worker for `workerData` (default: a real `worker_threads` Worker with `execArgv: []`). */
  workerFactory?: (workerData: { input: ReindexCoreInput }) => ReindexWorkerLike;
  /** `false` → always in-process. Default: `PI_DASHBOARD_KB_REINDEX_WORKER !== "0"`, read per job. */
  useWorker?: () => boolean;
  /** Override of {@link REINDEX_CANCEL_GRACE_MS}. */
  graceMs?: number;
}

export interface ReindexRunner {
  /** Run one job; rejects with an `AbortError` when cancelled. At most one live worker per `input.cwd`. */
  run(input: ReindexCoreInput, hooks?: ReindexCoreHooks): Promise<KbReindexResult>;
  /** Terminate every live worker immediately (server shutdown); resolves when they are gone. */
  shutdown(): Promise<void>;
  /** Live workers (diagnostics / tests). */
  liveCount(): number;
}

/** The error a cancelled run rejects with (`reindexAll` and the runner share it). */
export function abortError(message = "reindex cancelled"): Error {
  return Object.assign(new Error(message), { name: "AbortError" });
}
export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** A worker that died after `ready` (crash / OOM / unexpected exit). */
class WorkerCrash extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerCrash";
  }
}

type WorkerEnd = { kind: "result"; value: KbReindexResult } | { kind: "fallback"; reason: string };
type Outcome = "ok" | "error" | "cancelled" | "crashed";
type WorkerMessage = { kind?: string; [k: string]: unknown };

interface Live {
  terminateNow(): void;
  done: Promise<unknown>;
}

const defaultUseWorker = (): boolean => process.env[KILL_SWITCH] !== "0";

function unlinkFirstIndexTemp(dbPath: string): void {
  const tmp = `${dbPath}.tmp-${process.pid}`;
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true });
}

const outcomeOf = (e: unknown): Outcome => {
  if (isAbortError(e) || (e instanceof Error && e.name === "KbIndexAborted")) return "cancelled";
  return e instanceof WorkerCrash ? "crashed" : "error";
};

/** One job on one worker thread. Settles exactly once: a result, a `fallback` (failure before `ready`), or a rejection. */
class WorkerJob {
  private ready = false;
  private finished = false;
  private exited = false;
  /** A result / error / cancelled message arrived: the worker ended on its own terms. */
  private terminal = false;
  private cancelRequested = false;
  private shutdownRequested = false;
  private terminated = false;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private crash: string | undefined;
  private resolve!: (end: WorkerEnd) => void;
  private reject!: (e: Error) => void;
  private jobDone!: () => void;
  readonly done = new Promise<void>((r) => (this.jobDone = r));
  readonly promise = new Promise<WorkerEnd>((res, rej) => {
    this.resolve = res;
    this.reject = rej;
  });
  // Arrow fields: stable identities for `off()`.
  private readonly onMessage = (msg: unknown): void => this.handleMessage(msg as WorkerMessage | null);
  private readonly onError = (err: Error & { code?: string }): void => {
    this.crash = err.code === "ERR_WORKER_OUT_OF_MEMORY" ? `kb reindex worker ran out of memory (${err.code})` : `kb reindex worker crashed: ${errMsg(err)}`;
    this.terminate(); // idempotent; the thread is already dying → onExit settles the job
  };
  private readonly onExit = (code: number): void => this.handleExit(code);
  private readonly onAbort = (): void => this.handleAbort();

  private readonly worker: ReindexWorkerLike;
  private readonly input: ReindexCoreInput;
  private readonly hooks: ReindexCoreHooks;
  private readonly graceMs: number;
  private readonly live: Map<string, Live>;
  constructor(worker: ReindexWorkerLike, input: ReindexCoreInput, hooks: ReindexCoreHooks, graceMs: number, live: Map<string, Live>) {
    this.worker = worker;
    this.input = input;
    this.hooks = hooks;
    this.graceMs = graceMs;
    this.live = live;
  }

  start(): Promise<WorkerEnd> {
    this.live.set(this.input.cwd, {
      terminateNow: () => {
        this.shutdownRequested = true;
        this.terminate();
      },
      done: this.done,
    });
    this.worker.on("message", this.onMessage);
    this.worker.on("error", this.onError);
    this.worker.on("exit", this.onExit);
    const { signal } = this.hooks;
    if (signal?.aborted) this.handleAbort();
    else signal?.addEventListener("abort", this.onAbort, { once: true });
    return this.promise;
  }

  private settle(fn: () => void): void {
    if (this.finished) return;
    this.finished = true;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.hooks.signal?.removeEventListener("abort", this.onAbort);
    this.worker.off("message", this.onMessage);
    this.worker.off("error", this.onError);
    this.worker.off("exit", this.onExit);
    this.live.delete(this.input.cwd);
    this.jobDone();
    fn();
  }

  private terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.hooks.log?.info(`[kb-plugin] reindex worker terminate cwd=${this.input.cwd}`);
    // terminate() resolves once the thread is gone: do not depend on an `exit` event
    this.worker.terminate().then(
      () => this.handleExit(1),
      () => this.handleExit(1),
    );
  }

  /** The thread is gone: settle a job that did not end on its own terms. */
  private handleExit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.hooks.log?.info(`[kb-plugin] reindex worker exit code=${code} cwd=${this.input.cwd}`);
    if (this.terminal || this.finished) return;
    if (this.ready && this.input.mode === "first") unlinkFirstIndexTemp(this.input.dbPath);
    if (this.cancelRequested || this.shutdownRequested) this.settle(() => this.reject(abortError()));
    else if (!this.ready) this.settle(() => this.resolve({ kind: "fallback", reason: this.crash ?? `worker exited with code ${code} before it was ready` }));
    else this.settle(() => this.reject(new WorkerCrash(this.crash ?? `kb reindex worker exited unexpectedly (code ${code})`)));
  }

  private handleAbort(): void {
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    try {
      this.worker.postMessage({ kind: "cancel" });
    } catch {
      // the thread is already gone; its exit settles the job
    }
    this.graceTimer = setTimeout(() => this.terminate(), this.graceMs);
    this.graceTimer.unref?.();
  }

  private handleMessage(m: WorkerMessage | null): void {
    switch (m?.kind) {
      case "ready":
        this.ready = true;
        return;
      case "load-failed":
        if (this.ready || this.finished) return;
        this.crash = String(m.message ?? "worker failed to load");
        this.terminate(); // → handleExit → fallback
        return;
      case "progress":
        this.hooks.onProgress?.(m.progress as never);
        return;
      case "log":
        (m.level === "warn" ? this.hooks.log?.warn : this.hooks.log?.info)?.call(this.hooks.log, String(m.message));
        return;
      case "result":
        this.terminal = true;
        this.settle(() => this.resolve({ kind: "result", value: m.value as KbReindexResult }));
        return;
      case "error":
        this.terminal = true;
        this.settle(() => this.reject(new Error(String(m.message ?? "kb reindex worker failed"))));
        return;
      case "cancelled":
        this.terminal = true;
        this.settle(() => this.reject(abortError()));
        return;
    }
  }
}

export function createReindexRunner(o: ReindexRunnerOptions = {}): ReindexRunner {
  const workerUrl = o.workerUrl ?? new URL("./reindex-worker.mjs", import.meta.url);
  const factory = o.workerFactory ?? ((workerData) => new Worker(workerUrl, { execArgv: [], workerData }) as unknown as ReindexWorkerLike);
  const useWorker = o.useWorker ?? defaultUseWorker;
  const graceMs = o.graceMs ?? REINDEX_CANCEL_GRACE_MS;
  const live = new Map<string, Live>();

  /** Run on a worker. Resolves with the result, or `fallback` for a pre-`ready` failure; rejects otherwise. */
  function runInWorker(input: ReindexCoreInput, hooks: ReindexCoreHooks): Promise<WorkerEnd> {
    let worker: ReindexWorkerLike;
    try {
      worker = factory({ input });
    } catch (e) {
      return Promise.resolve({ kind: "fallback", reason: `worker spawn failed: ${errMsg(e)}` });
    }
    hooks.log?.info(`[kb-plugin] reindex worker started cwd=${input.cwd}`);
    return new WorkerJob(worker, input, hooks, graceMs, live).start();
  }

  /** Worker first; the same core in-process when the kill-switch is set or the worker failed to load. */
  async function execute(input: ReindexCoreInput, hooks: ReindexCoreHooks, state: { mode: "worker" | "inprocess" }): Promise<KbReindexResult> {
    const { log, signal } = hooks;
    if (signal?.aborted) throw abortError();
    if (live.has(input.cwd)) throw new Error(`a reindex worker is already running for ${input.cwd}`);
    if (useWorker()) {
      state.mode = "worker";
      const end = await runInWorker(input, hooks);
      if (end.kind === "result") return end.value;
      state.mode = "inprocess";
      if (signal?.aborted) throw abortError();
      log?.warn(`[kb-plugin] reindex worker failed to load (${end.reason}); running this job in-process`);
    }
    return runReindexCore(input, hooks);
  }

  async function run(input: ReindexCoreInput, hooks: ReindexCoreHooks = {}): Promise<KbReindexResult> {
    const t0 = Date.now();
    const state = { mode: "inprocess" as "worker" | "inprocess" };
    let outcome: Outcome = "ok";
    let chunks = 0;
    try {
      const value = await execute(input, hooks, state);
      chunks = value.chunks;
      return value;
    } catch (e) {
      outcome = outcomeOf(e);
      throw e;
    } finally {
      hooks.log?.info(`[kb-plugin] reindex mode=${state.mode} sources=${input.sources.length} chunks=${chunks} ms=${Date.now() - t0} outcome=${outcome} cwd=${input.cwd}`);
    }
  }

  return {
    run,
    liveCount: () => live.size,
    async shutdown(): Promise<void> {
      const all = [...live.values()];
      for (const l of all) l.terminateNow();
      await Promise.all(all.map((l) => l.done));
    },
  };
}

let shared: ReindexRunner | undefined;
/** The process-wide runner `reindexAll` uses when a caller does not inject one. */
export function defaultReindexRunner(): ReindexRunner {
  return (shared ??= createReindexRunner());
}
