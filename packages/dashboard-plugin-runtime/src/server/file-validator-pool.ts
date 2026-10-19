/**
 * Bounded `worker_threads` pool that runs plugin file validators off the main
 * thread: `size` workers (default 2), a FIFO queue of `queueMax` (default 8),
 * overflow → `busy`, and a hard `terminate()` after `timeoutMs` (default 5 s)
 * so a synchronous loop in a validator cannot block the server. Bytes are
 * transferred to the worker and back (never cloned) when the buffer owns its
 * ArrayBuffer. See change: add-editor-pane-file-handlers (D4).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export type FileValidationOutcome =
  /** Accepted; `bytes` is the (unchanged) body, re-attached after the round trip. */
  | { kind: "ok"; bytes: Buffer }
  | { kind: "rejected"; reason: string }
  /** The validator threw, crashed, or mutated the bytes. */
  | { kind: "error"; reason: string }
  | { kind: "timeout" }
  /** Queue full — retryable. */
  | { kind: "busy" };

export interface FileValidationJob {
  /** `file://` URL of the validator module (realpath-confined by the registry). */
  moduleUrl: string;
  bytes: Buffer;
  /** Lower-cased extension with leading dot. */
  ext: string;
}

export interface FileValidatorPool {
  run(job: FileValidationJob): Promise<FileValidationOutcome>;
  dispose(): Promise<void>;
}

export interface FileValidatorPoolOptions {
  size?: number;
  queueMax?: number;
  timeoutMs?: number;
  /** Override the worker entry (tests). */
  workerUrl?: string;
}

interface Job {
  id: number;
  job: FileValidationJob;
  resolve: (o: FileValidationOutcome) => void;
  timer: NodeJS.Timeout | null;
  done: boolean;
}

interface Slot {
  worker: Worker | null;
  current: Job | null;
}

function defaultWorkerUrl(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(here, "file-validator-worker.mjs")).href;
}

/** An ArrayBuffer that exactly backs `buf` (copied when `buf` is a view into a larger/pooled one). */
function exclusiveArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = buf.buffer;
  if (ab instanceof ArrayBuffer && buf.byteOffset === 0 && buf.byteLength === ab.byteLength) return ab;
  return Uint8Array.prototype.slice.call(buf).buffer as ArrayBuffer;
}

export function createFileValidatorPool(opts: FileValidatorPoolOptions = {}): FileValidatorPool {
  const size = Math.max(1, opts.size ?? 2);
  const queueMax = Math.max(0, opts.queueMax ?? 8);
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const workerUrl = opts.workerUrl ?? defaultWorkerUrl();
  const slots: Slot[] = Array.from({ length: size }, () => ({ worker: null, current: null }));
  const queue: Job[] = [];
  let nextId = 1;
  let disposed = false;

  function settle(j: Job, out: FileValidationOutcome): void {
    if (j.done) return;
    j.done = true;
    if (j.timer) clearTimeout(j.timer);
    j.resolve(out);
  }

  function retire(slot: Slot): void {
    const w = slot.worker;
    slot.worker = null;
    slot.current = null;
    if (w) void w.terminate().catch(() => {});
  }

  function spawn(slot: Slot): Worker {
    const w = new Worker(new URL(workerUrl));
    w.unref();
    w.on("message", (msg: { id: number; kind: "ok" | "rejected" | "error"; reason?: string; bytes: ArrayBuffer; before?: string; after?: string }) => {
      const j = slot.current;
      if (!j || j.id !== msg.id) return;
      slot.current = null;
      if (msg.kind === "ok") {
        if (msg.before !== msg.after) settle(j, { kind: "error", reason: "validator modified the bytes" });
        else settle(j, { kind: "ok", bytes: Buffer.from(msg.bytes) });
      } else {
        settle(j, { kind: msg.kind, reason: msg.reason ?? msg.kind });
      }
      drain();
    });
    w.on("error", (err) => {
      const j = slot.current;
      retire(slot);
      if (j) settle(j, { kind: "error", reason: err instanceof Error ? err.message : String(err) });
      drain();
    });
    w.on("exit", () => {
      if (slot.worker !== w) return;
      const j = slot.current;
      slot.worker = null;
      slot.current = null;
      if (j) settle(j, { kind: "error", reason: "validator worker exited" });
      drain();
    });
    slot.worker = w;
    return w;
  }

  function dispatch(slot: Slot, j: Job): void {
    slot.current = j;
    try {
      const w = slot.worker ?? spawn(slot);
      const ab = exclusiveArrayBuffer(j.job.bytes);
      j.timer = setTimeout(() => {
        if (slot.current !== j) return;
        retire(slot); // hard terminate: a sync loop cannot be interrupted any other way
        settle(j, { kind: "timeout" });
        drain();
      }, timeoutMs);
      j.timer.unref?.();
      w.postMessage({ id: j.id, moduleUrl: j.job.moduleUrl, ext: j.job.ext, bytes: ab }, [ab]);
    } catch (err) {
      retire(slot);
      settle(j, { kind: "error", reason: err instanceof Error ? err.message : String(err) });
      drain();
    }
  }

  function drain(): void {
    if (disposed) return;
    while (queue.length > 0) {
      const slot = slots.find((s) => s.current === null);
      if (!slot) return;
      dispatch(slot, queue.shift() as Job);
    }
  }

  return {
    run(job) {
      if (disposed) return Promise.resolve({ kind: "error", reason: "pool disposed" });
      const idle = slots.find((s) => s.current === null);
      if (!idle && queue.length >= queueMax) return Promise.resolve({ kind: "busy" });
      return new Promise<FileValidationOutcome>((resolveJob) => {
        const j: Job = { id: nextId++, job, resolve: resolveJob, timer: null, done: false };
        if (idle) dispatch(idle, j);
        else queue.push(j);
      });
    },
    async dispose() {
      disposed = true;
      for (const j of queue.splice(0)) settle(j, { kind: "error", reason: "pool disposed" });
      for (const slot of slots) {
        const j = slot.current;
        retire(slot);
        if (j) settle(j, { kind: "error", reason: "pool disposed" });
      }
    },
  };
}

let shared: FileValidatorPool | null = null;
/** Process-wide pool used by the `write-binary` route (lazy; workers spawn on first use). */
export function getFileValidatorPool(): FileValidatorPool {
  if (!shared) shared = createFileValidatorPool();
  return shared;
}
