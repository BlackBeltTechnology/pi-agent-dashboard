/**
 * Bounded pattern matcher for user-authored custom-event-group regexes.
 *
 * Design D3 (see change: add-custom-event-group-filters): JavaScript cannot
 * time-bound a synchronous regex, so every user pattern is tested in a
 * long-lived `worker_threads` worker, one pattern per message. The main
 * thread arms a per-message timer; on expiry the worker is `terminate()`d —
 * killing the backtracking mid-flight — the pending match REJECTS so the
 * caller can quarantine the offending group, and the next `match()` lazily
 * respawns a fresh worker.
 *
 * This path runs once per distinct `customType` per process (resolver-level
 * memoization), so the round-trip cost is irrelevant.
 */
import { Worker } from "node:worker_threads";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { MatcherResponse } from "./custom-event-group-matcher-worker.js";

function defaultWorkerUrl(): string {
  // The worker entry is a sibling .ts module; jiti (inherited via
  // `execArgv: process.execArgv`) loads it transparently in the worker thread.
  const here = dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(here, "custom-event-group-matcher-worker.ts")).href;
}

export interface CustomEventGroupMatcherDeps {
  /** Per-message timeout. Any value in the tens-of-ms range satisfies D3. */
  timeoutMs?: number;
  /** Worker entry URL override (tests). */
  workerUrl?: string;
  /** Logger hook (defaults to console.warn). Tests inject a sink. */
  warn?(message: string): void;
}

interface PendingMatch {
  resolve: (matched: boolean) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CustomEventGroupMatcher {
  private readonly timeoutMs: number;
  private readonly workerUrl: string;
  private readonly warn: (message: string) => void;
  private worker: Worker | null = null;
  /** Cleared when the worker died and the next match() must respawn. */
  private workerDead = true;
  /** Boot gate — resolves once the freshly spawned worker signals ready. */
  private ready: Promise<void> | null = null;
  private nextIdx = 0;
  private readonly pending = new Map<number, PendingMatch>();
  private terminatedWorkers = 0;

  constructor(deps: CustomEventGroupMatcherDeps = {}) {
    this.timeoutMs = deps.timeoutMs ?? 100;
    this.workerUrl = deps.workerUrl ?? defaultWorkerUrl();
    this.warn = deps.warn ?? ((m) => console.warn(`[custom-event-groups] ${m}`));
  }

  /** Times the worker was killed on expiry — bounded by configured group count (D3). */
  terminateCount(): number {
    return this.terminatedWorkers;
  }

  /**
   * Test `customType` against `pattern` off-thread. Resolves the boolean
   * result; REJECTS when the match is abandoned (timeout → worker killed,
   * boot failure, or the worker died unexpectedly) so the caller can
   * quarantine the group.
   *
   * Matches are SERIALIZED (FIFO, one in-flight per worker): a timeout kills
   * the whole worker, so concurrent matches would make the kill orphan a
   * healthy sibling's response and its own timer would then quarantine an
   * innocent group. Serializing means the deadline bounds exactly the one
   * match that is in flight, and a kill only ever abandons the offender.
   * Cost is irrelevant — the resolver memoizes per customType, so this path
   * runs once per distinct type per process (design D3).
   *
   * Worker boot is NOT part of the match deadline: the deadline bounds only
   * regex execution (design D3), so a slow first boot cannot spuriously
   * quarantine a group.
   */
  private tail: Promise<void> = Promise.resolve();

  match(pattern: string, customType: string): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      await this.ensureReady();
      const idx = this.nextIdx++;
      return new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(idx);
          this.killWorker();
          reject(new Error(`pattern match exceeded ${this.timeoutMs}ms; worker terminated`));
        }, this.timeoutMs);
        this.pending.set(idx, { resolve, reject, timer });
        try {
          this.ensureWorker().postMessage({ idx, pattern, customType });
        } catch {
          // postMessage can throw on a just-killed worker; retry once on a
          // fresh worker so one kill never wedges the matcher.
          this.pending.delete(idx);
          clearTimeout(timer);
          const retryTimer = setTimeout(() => {
            this.pending.delete(idx);
            this.killWorker();
            reject(new Error(`pattern match exceeded ${this.timeoutMs}ms; worker terminated`));
          }, this.timeoutMs);
          this.pending.set(idx, { resolve, reject, timer: retryTimer });
          try {
            this.ensureWorker().postMessage({ idx, pattern, customType });
          } catch (err2) {
            this.pending.delete(idx);
            clearTimeout(retryTimer);
            reject(err2 instanceof Error ? err2 : new Error(String(err2)));
          }
        }
      });
    };
    // FIFO over the previous match — run regardless of how the predecessor
    // settled (a rejection must not stall the queue).
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async dispose(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("matcher disposed"));
    }
    this.pending.clear();
    this.ready = null;
    await this.killWorkerAsync();
  }

  /** Wait for the current worker's readiness banner (boot + module load). */
  private ensureReady(): Promise<void> {
    if (this.ready !== null) return this.ready;
    const w = this.ensureWorker();
    this.ready = new Promise<void>((resolve, reject) => {
      const bootTimer = setTimeout(
        () => reject(new Error("matcher worker boot timeout")),
        10_000,
      );
      const onReady = (msg: { ready?: boolean }) => {
        if (msg?.ready === true) {
          clearTimeout(bootTimer);
          w.removeListener("message", onReady);
          resolve();
        }
      };
      w.on("message", onReady);
      const failBoot = (err: Error) => {
        if (w !== this.worker) return;
        this.ready = null;
        this.workerDead = true;
        clearTimeout(bootTimer);
        // A worker that never became ready is a stuck thread: terminate it so
        // the next ensureWorker() cannot accumulate hung boots.
        try {
          w.terminate();
        } catch {
          // already dead — nothing to do
        }
        reject(err);
      };
      w.once("error", (err) => failBoot(err instanceof Error ? err : new Error(String(err))));
      w.once("exit", (code) => {
        if (code !== 0) failBoot(new Error(`matcher worker exited ${code} during boot`));
      });
    });
    return this.ready;
  }

  private ensureWorker(): Worker {
    if (this.worker && !this.workerDead) return this.worker;
    const w = new Worker(new URL(this.workerUrl), {
      // Inherit `--import jiti-register.mjs` so the worker loads the .ts entry.
      execArgv: [...process.execArgv],
    });
    w.unref();
    w.on("message", (msg: MatcherResponse) => {
      if (w !== this.worker) return; // stale worker's stragglers
      const p = this.pending.get(msg.idx);
      if (!p) return;
      this.pending.delete(msg.idx);
      clearTimeout(p.timer);
      p.resolve(msg.matched);
    });
    w.on("error", (err: Error) => {
      if (w !== this.worker) return; // a killed worker's late error must not
      this.workerDead = true; //      poison its respawned replacement
      this.ready = null;
      this.failAllPending(new Error(`matcher worker error: ${err.message}`));
    });
    w.on("exit", (code) => {
      if (w !== this.worker) return;
      this.workerDead = true;
      this.ready = null;
      if (code !== 0) this.failAllPending(new Error(`matcher worker exited ${code}`));
    });
    this.worker = w;
    this.workerDead = false;
    return w;
  }

  /** Terminate synchronously (timeout path). Pending matches were already rejected. */
  private killWorker(): void {
    this.terminatedWorkers++;
    this.workerDead = true;
    this.ready = null;
    const w = this.worker;
    this.worker = null;
    try {
      w?.terminate();
    } catch {
      // already dead — nothing to do
    }
  }

  private async killWorkerAsync(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.workerDead = true;
    this.ready = null;
    if (w) await w.terminate();
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.warn(err.message);
  }
}
