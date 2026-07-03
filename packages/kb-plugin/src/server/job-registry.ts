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
import type { KbJobStatus, KbReindexResult } from "../shared/kb-plugin-types.js";

export interface JobState {
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  changed?: number;
  chunks?: number;
  error?: string;
}

let jobSeq = 0;

export class KbJobRegistry {
  private jobs = new Map<string, JobState>();
  private inflight = new Map<string, Promise<KbReindexResult>>();
  private ids = new Map<string, string>();

  /** True while a reindex walk for `cwd` is in progress. */
  isRunning(cwd: string): boolean {
    return this.inflight.has(cwd);
  }

  /** The in-flight job id for `cwd`, when running. */
  jobId(cwd: string): string | undefined {
    return this.ids.get(cwd);
  }

  /** Last/current job state for `cwd` (undefined = never run). */
  get(cwd: string): JobState | undefined {
    return this.jobs.get(cwd);
  }

  /** Derive the client-facing job status for `cwd`. A completed job → idle;
   *  a *failed* last job → error (until a later success clears it). */
  statusFor(cwd: string): KbJobStatus {
    if (this.inflight.has(cwd)) return "running";
    return this.jobs.get(cwd)?.status === "error" ? "error" : "idle";
  }

  /**
   * Start a reindex for `cwd`, or return the existing in-flight promise when
   * one is already running (coalesce). `running` is set SYNCHRONOUSLY before
   * returning, so a concurrent second call observes it and does not start a
   * second walk.
   */
  start(cwd: string, fn: () => Promise<KbReindexResult>): { coalesced: boolean; promise: Promise<KbReindexResult> } {
    const existing = this.inflight.get(cwd);
    if (existing) return { coalesced: true, promise: existing };

    this.jobs.set(cwd, { status: "running", startedAt: Date.now() });
    this.ids.set(cwd, `kb-${++jobSeq}`);
    const promise = Promise.resolve()
      .then(fn)
      .then(
        (r) => {
          this.jobs.set(cwd, { status: "done", startedAt: this.jobs.get(cwd)?.startedAt ?? Date.now(), finishedAt: Date.now(), changed: r.changed, chunks: r.chunks });
          this.inflight.delete(cwd);
          this.ids.delete(cwd);
          return r;
        },
        (e) => {
          this.jobs.set(cwd, { status: "error", startedAt: this.jobs.get(cwd)?.startedAt ?? Date.now(), finishedAt: Date.now(), error: e instanceof Error ? e.message : String(e) });
          this.inflight.delete(cwd);
          this.ids.delete(cwd);
          throw e;
        },
      );
    this.inflight.set(cwd, promise);
    return { coalesced: false, promise };
  }
}
