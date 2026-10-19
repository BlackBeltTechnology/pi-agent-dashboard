/**
 * Bounded `worker_threads` pool that runs plugin file validators OFF the main
 * thread, so a validator that loops forever cannot block the server.
 *
 * Contract (change: add-editor-pane-file-handlers D4):
 *   - 2 workers, FIFO queue of 8; a 11th concurrent request is refused with
 *     `FileValidatorBusyError` (route → 503, retryable).
 *   - Hard `terminate()` of the worker after `timeoutMs` (default 5 s); the slot
 *     respawns lazily. Timeout → `{ ok:false, kind:"timeout" }`.
 *   - Bytes are TRANSFERRED to the worker as a copy made when the job starts
 *     (the caller's buffer stays valid for the write that follows).
 *   - A validator can only reject: a throw / bad module / `{ok:false}` is a
 *     rejection (`kind:"error"` / `"reject"`), never an admit.
 *
 * The worker is an inline CommonJS script (`eval: true`) that `import()`s the
 * validator module, so it needs no TypeScript loader or packaged entry file.
 */
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const VALIDATOR_POOL_SIZE = 2;
const VALIDATOR_QUEUE_MAX = 8;
const VALIDATOR_TIMEOUT_MS = 5_000;

type ValidatorOutcome =
  | { ok: true }
  | { ok: false; kind: "reject" | "timeout" | "error"; reason: string };

/** Pool saturated: 2 running + 8 queued. */
export class FileValidatorBusyError extends Error {
  constructor() {
    super("file validator pool is busy");
    this.name = "FileValidatorBusyError";
  }
}

export interface FileValidatorPool {
  /** Run `modulePath`'s `validate(bytes, ext)`. Rejects with `FileValidatorBusyError` when saturated. */
  validate(modulePath: string, bytes: Uint8Array, ext: string): Promise<ValidatorOutcome>;
  /** Terminate every worker; pending jobs resolve as errors. */
  dispose(): Promise<void>;
}

export interface FileValidatorPoolOptions {
  size?: number;
  queueMax?: number;
  timeoutMs?: number;
}

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const cache = new Map();
const clip = (v) => String(v && v.message ? v.message : v).slice(0, 300);
parentPort.on("message", async (m) => {
  try {
    let mod = cache.get(m.moduleUrl);
    if (!mod) { mod = await import(m.moduleUrl); cache.set(m.moduleUrl, mod); }
    const fn = typeof mod.validate === "function" ? mod.validate : mod.default && mod.default.validate;
    if (typeof fn !== "function") throw new Error("validator module exports no validate()");
    const r = await fn(new Uint8Array(m.bytes), m.ext);
    if (r && r.ok === true) parentPort.postMessage({ id: m.id, ok: true });
    else parentPort.postMessage({ id: m.id, ok: false, reason: r && typeof r.reason === "string" ? r.reason.slice(0, 300) : "rejected" });
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: clip(e) });
  }
});
`;

interface Job {
  modulePath: string;
  bytes: Uint8Array;
  ext: string;
  resolve: (o: ValidatorOutcome) => void;
}

interface Slot {
  worker: Worker | null;
  job: { id: number; job: Job; timer: NodeJS.Timeout } | null;
}

export function createFileValidatorPool(opts: FileValidatorPoolOptions = {}): FileValidatorPool {
  const size = Math.max(1, opts.size ?? VALIDATOR_POOL_SIZE);
  const queueMax = Math.max(0, opts.queueMax ?? VALIDATOR_QUEUE_MAX);
  const timeoutMs = opts.timeoutMs ?? VALIDATOR_TIMEOUT_MS;
  const slots: Slot[] = Array.from({ length: size }, () => ({ worker: null, job: null }));
  const queue: Job[] = [];
  let nextId = 1;
  let disposed = false;

  function finish(slot: Slot, outcome: ValidatorOutcome): void {
    const running = slot.job;
    if (!running) return;
    clearTimeout(running.timer);
    slot.job = null;
    running.job.resolve(outcome);
    pump();
  }

  function kill(slot: Slot): void {
    const w = slot.worker;
    slot.worker = null; // respawned lazily
    if (w) void w.terminate().catch(() => {});
  }

  function spawn(slot: Slot): Worker {
    const w = new Worker(WORKER_SOURCE, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 } });
    w.unref(); // an idle validator worker must not hold the process open
    w.on("message", (m: { id: number; ok?: boolean; reason?: string; error?: string }) => {
      if (slot.worker !== w || slot.job?.id !== m.id) return; // stale
      if (m.error !== undefined) finish(slot, { ok: false, kind: "error", reason: m.error });
      else if (m.ok) finish(slot, { ok: true });
      else finish(slot, { ok: false, kind: "reject", reason: m.reason ?? "rejected" });
    });
    const onDead = (reason: string): void => {
      if (slot.worker !== w) return;
      slot.worker = null;
      finish(slot, { ok: false, kind: "error", reason });
    };
    w.on("error", (e) => onDead(`validator worker crashed: ${e instanceof Error ? e.message : String(e)}`));
    w.on("exit", (code) => onDead(`validator worker exited (${code})`));
    return w;
  }

  function start(slot: Slot, job: Job): void {
    const id = nextId++;
    let worker: Worker;
    try {
      worker = slot.worker ?? (slot.worker = spawn(slot));
    } catch (e) {
      job.resolve({ ok: false, kind: "error", reason: `cannot start validator worker: ${e instanceof Error ? e.message : String(e)}` });
      pump();
      return;
    }
    const timer = setTimeout(() => {
      if (slot.job?.id !== id) return;
      kill(slot);
      finish(slot, { ok: false, kind: "timeout", reason: "validator timed out" });
    }, timeoutMs);
    slot.job = { id, job, timer };
    // Copy at dispatch (≤ `size` copies alive at once) so the caller keeps its buffer.
    const copy = new ArrayBuffer(job.bytes.byteLength);
    new Uint8Array(copy).set(job.bytes);
    worker.postMessage(
      { id, moduleUrl: pathToFileURL(job.modulePath).href, bytes: copy, ext: job.ext },
      [copy],
    );
  }

  function pump(): void {
    if (disposed) return;
    for (const slot of slots) {
      if (slot.job) continue;
      const job = queue.shift();
      if (!job) return;
      start(slot, job);
    }
  }

  return {
    validate(modulePath, bytes, ext) {
      if (disposed) return Promise.resolve({ ok: false, kind: "error", reason: "validator pool disposed" });
      const busy = slots.filter((s) => s.job).length;
      if (busy >= size && queue.length >= queueMax) return Promise.reject(new FileValidatorBusyError());
      return new Promise<ValidatorOutcome>((resolve) => {
        queue.push({ modulePath, bytes, ext, resolve });
        pump();
      });
    },
    async dispose() {
      disposed = true;
      for (const job of queue.splice(0)) job.resolve({ ok: false, kind: "error", reason: "validator pool disposed" });
      for (const slot of slots) {
        if (slot.job) finish(slot, { ok: false, kind: "error", reason: "validator pool disposed" });
        kill(slot);
      }
    },
  };
}
