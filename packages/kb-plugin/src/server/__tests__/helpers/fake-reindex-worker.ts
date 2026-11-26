/**
 * Scripted stand-in for a `worker_threads` Worker, handed to the reindex runner through its injectable
 * `workerFactory` (precedent: packages/server/src/__tests__/credential-key-worker.test.ts). It never runs
 * the indexing core: tests drive it with `ready()` / `progress()` / `result()` / `crash()` / `exit()`.
 * See change: throttle-kb-reindex (D3).
 */
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { KbReindexResult } from "../../../shared/kb-plugin-types.js";
import type { ReindexCoreInput } from "../../reindex-core.js";
import type { ReindexWorkerLike } from "../../reindex-runner.js";

export class FakeReindexWorker extends EventEmitter implements ReindexWorkerLike {
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn(async () => {
    queueMicrotask(() => this.emit("exit", 1));
    return 1;
  });
  readonly input: ReindexCoreInput;
  constructor(input: ReindexCoreInput) {
    super();
    this.input = input;
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  ready(): this {
    this.emit("message", { kind: "ready" });
    return this;
  }
  loadFailed(message = "cannot import kb"): this {
    this.emit("message", { kind: "load-failed", message });
    return this;
  }
  progress(root: string, done: number, total: number): this {
    this.emit("message", { kind: "progress", progress: { root, done, total } });
    return this;
  }
  log(level: "info" | "warn", message: string): this {
    this.emit("message", { kind: "log", level, message });
    return this;
  }
  result(value: KbReindexResult = { changed: 0, chunks: 0, outcomes: [] }): this {
    this.emit("message", { kind: "result", value });
    return this;
  }
  cancelled(): this {
    this.emit("message", { kind: "cancelled" });
    return this;
  }
  crash(err: Error & { code?: string }): this {
    this.emit("error", err);
    return this;
  }
  exit(code: number): this {
    this.emit("exit", code);
    return this;
  }
  /** True once the runner posted `{kind:"cancel"}`. */
  get gotCancel(): boolean {
    return this.posted.some((m) => (m as { kind?: string })?.kind === "cancel");
  }
}

/** A `workerFactory` that records every spawned fake; `onSpawn` scripts its behaviour. */
export function fakeFactory(onSpawn?: (w: FakeReindexWorker) => void): {
  factory: (data: { input: ReindexCoreInput }) => ReindexWorkerLike;
  workers: FakeReindexWorker[];
} {
  const workers: FakeReindexWorker[] = [];
  return {
    workers,
    factory: ({ input }) => {
      const w = new FakeReindexWorker(input);
      workers.push(w);
      if (onSpawn) setImmediate(() => onSpawn(w));
      return w;
    },
  };
}
