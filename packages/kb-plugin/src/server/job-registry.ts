/**
 * Per-cwd reindex job registry (design §4).
 *
 * Coalesces concurrent reindex requests for one cwd onto a single in-flight
 * walk and retains the last result / error so `GET /stats` can report
 * `indexing` + `jobStatus` + `lastError`. No cross-process durability —
 * reindex is idempotent, a lost job just reruns on the next click.
 *
 * See change: add-kb-folder-slot.
 */
import type { KbJobStatus, KbReindexResult, KbSourceOutcome } from "../shared/kb-plugin-types.js";

export interface JobState {
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  changed?: number;
  chunks?: number;
  error?: string;
  /** Per-source outcomes of the last SETTLED walk (kept across a later thrown job). */
  outcomes?: KbSourceOutcome[];
}

/** Files done/total for the source root currently being indexed (transient, never persisted). */
export interface JobProgress {
  root: string;
  done: number;
  total: number;
}
/** What `start(cwd, fn)` hands the job: `signal` aborts on `cancel(cwd)`; `progress` reports a batch commit.
 *  `fn` may ignore its argument (pre-cancel callers). See change: throttle-kb-reindex (D3). */
export interface JobContext {
  signal: AbortSignal;
  progress: (p: JobProgress) => void;
}

interface ActiveJob {
  controller: AbortController;
  /** Job state before this job started; restored when the job settles after a cancel. */
  prior: JobState | undefined;
  cancelling: boolean;
  progress?: JobProgress;
}
interface PendingStart {
  fn: (ctx: JobContext) => Promise<KbReindexResult>;
  promise: Promise<KbReindexResult>;
  run: () => void;
  reject: (e: Error) => void;
}

const MAX_ERROR_CHARS = 500;

/** `error` outcomes → one truncated job error; `untrusted` alone is not an error. */
function summarizeFailures(outcomes: KbSourceOutcome[] | undefined): string | undefined {
  const failed = (outcomes ?? []).filter((o) => o.status === "error");
  if (failed.length === 0) return undefined;
  const text = `${failed.length} source(s) failed: ${failed.map((o) => `${o.ref}: ${o.error ?? "error"}`).join("; ")}`;
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

let jobSeq = 0;

export class KbJobRegistry {
  private jobs = new Map<string, JobState>();
  private inflight = new Map<string, Promise<KbReindexResult>>();
  private ids = new Map<string, string>();
  private active = new Map<string, ActiveJob>();
  /** A `start` that arrived while the running job was cancelling: runs once that job settles. */
  private pending = new Map<string, PendingStart>();

  /** True while a reindex walk for `cwd` is in progress (including while it is cancelling). */
  isRunning(cwd: string): boolean {
    return this.inflight.has(cwd);
  }

  /** True when a `start` for `cwd` would coalesce onto the running job: it runs and is not cancelling (a cancelling
   *  job is not joined — the request queues behind it instead of being dropped). */
  willCoalesce(cwd: string): boolean {
    return this.inflight.has(cwd) && !this.isCancelling(cwd);
  }

  /** True while `cwd`'s running job has been asked to stop but has not settled yet. */
  isCancelling(cwd: string): boolean {
    return this.active.get(cwd)?.cancelling === true;
  }

  /** Last progress reported by the running job for `cwd` (undefined when idle or before the first batch). */
  progressFor(cwd: string): JobProgress | undefined {
    return this.active.get(cwd)?.progress;
  }

  /** The in-flight job id for `cwd`, when running. */
  jobId(cwd: string): string | undefined {
    return this.ids.get(cwd);
  }

  /** Last/current job state for `cwd` (undefined = never run). */
  get(cwd: string): JobState | undefined {
    return this.jobs.get(cwd);
  }

  /** Outcomes of the last settled walk for `cwd` (empty when none). */
  outcomesFor(cwd: string): KbSourceOutcome[] {
    return this.jobs.get(cwd)?.outcomes ?? [];
  }

  /** Derive the client-facing job status for `cwd`. A completed job → idle;
   *  a *failed* last job → error (until a later success clears it). A cancelling
   *  job still reports `running` (no extra status value). */
  statusFor(cwd: string): KbJobStatus {
    if (this.inflight.has(cwd)) return "running";
    return this.jobs.get(cwd)?.status === "error" ? "error" : "idle";
  }

  /**
   * Ask `cwd`'s running job to stop: aborts its signal once (repeat calls are idempotent). The job
   * settles when `fn` settles, restoring the pre-start state — a cancelled run is neither a success
   * nor a failure. A `start` still queued behind a cancelling job is dropped (its promise rejects
   * with an `AbortError`). Returns false when nothing was running or queued.
   */
  cancel(cwd: string): boolean {
    const queued = this.pending.get(cwd);
    if (queued) {
      this.pending.delete(cwd);
      queued.reject(Object.assign(new Error("reindex cancelled before it started"), { name: "AbortError" }));
    }
    const job = this.active.get(cwd);
    if (!job) return queued !== undefined;
    if (!job.cancelling) {
      job.cancelling = true;
      job.controller.abort();
    }
    return true;
  }

  /**
   * Start a reindex for `cwd`, or return the existing in-flight promise when
   * one is already running (coalesce). `running` is set SYNCHRONOUSLY before
   * returning, so a concurrent second call observes it and does not start a
   * second walk. While the running job is cancelling, a new call is queued and
   * runs as a fresh job once the old one settles (not coalesced onto the dying
   * job, not dropped); further calls meanwhile coalesce onto the queued one.
   */
  start(cwd: string, fn: (ctx: JobContext) => Promise<KbReindexResult>): { coalesced: boolean; promise: Promise<KbReindexResult> } {
    const queued = this.pending.get(cwd);
    if (queued) return { coalesced: true, promise: queued.promise };
    const existing = this.inflight.get(cwd);
    if (!existing) return { coalesced: false, promise: this.run(cwd, fn) };
    if (!this.isCancelling(cwd)) return { coalesced: true, promise: existing };

    let run!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<KbReindexResult>((resolve, rej) => {
      run = () => this.run(cwd, fn).then(resolve, rej);
      reject = rej;
    });
    this.pending.set(cwd, { fn, promise, run, reject });
    return { coalesced: false, promise };
  }

  private run(cwd: string, fn: (ctx: JobContext) => Promise<KbReindexResult>): Promise<KbReindexResult> {
    const prior = this.jobs.get(cwd);
    const job: ActiveJob = { controller: new AbortController(), prior, cancelling: false };
    this.active.set(cwd, job);
    this.jobs.set(cwd, { status: "running", startedAt: Date.now(), ...(prior?.outcomes ? { outcomes: prior.outcomes } : {}) });
    this.ids.set(cwd, `kb-${++jobSeq}`);
    const ctx: JobContext = {
      signal: job.controller.signal,
      progress: (p) => {
        if (this.active.get(cwd) === job) job.progress = p; // a settled job's late message is ignored
      },
    };
    /** Common tail of every settle: drop job bookkeeping, then start a queued `start`, if any. */
    const settle = () => {
      this.inflight.delete(cwd);
      this.ids.delete(cwd);
      this.active.delete(cwd);
      const queued = this.pending.get(cwd);
      if (queued) {
        this.pending.delete(cwd);
        queued.run();
      }
    };
    const restorePrior = () => {
      if (prior) this.jobs.set(cwd, prior);
      else this.jobs.delete(cwd);
    };
    const promise = Promise.resolve()
      .then(() => fn(ctx))
      .then(
        (r) => {
          if (job.cancelling) restorePrior();
          else {
            const failure = summarizeFailures(r.outcomes);
            this.jobs.set(cwd, {
              status: failure ? "error" : "done",
              startedAt: this.jobs.get(cwd)?.startedAt ?? Date.now(),
              finishedAt: Date.now(),
              changed: r.changed,
              chunks: r.chunks,
              ...(failure ? { error: failure } : {}),
              ...(r.outcomes ? { outcomes: r.outcomes } : {}),
            });
          }
          settle();
          return r;
        },
        (e) => {
          if (job.cancelling) restorePrior();
          else {
            const outcomes = this.jobs.get(cwd)?.outcomes;
            this.jobs.set(cwd, { status: "error", startedAt: this.jobs.get(cwd)?.startedAt ?? Date.now(), finishedAt: Date.now(), error: e instanceof Error ? e.message : String(e), ...(outcomes ? { outcomes } : {}) });
          }
          settle();
          throw e;
        },
      );
    this.inflight.set(cwd, promise);
    return promise;
  }
}
