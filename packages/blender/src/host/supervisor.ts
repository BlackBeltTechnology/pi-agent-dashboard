/**
 * Session supervisor (design D6): owns the one disposable Blender host child.
 *
 * - Lazy: nothing is probed, provisioned or spawned before the first call.
 * - FIFO, one call in flight, queue depth <= 32 (`limit-exceeded`); queued calls read their inputs at dequeue.
 * - First call: probe JSPI once (`jspi-unavailable`) -> provision (`provision-failed`) -> spawn + boot within
 *   120 s (`boot-failed` + cache repair). The per-call timeout covers only the operation.
 * - Timeout / cancel / idle / server shutdown kill the host with SIGKILL (a process kill is the only thing
 *   that reliably frees ~1 GB, ends a wedged JSPI call and contains an abort); a host that dies mid-call is
 *   `session-crashed` with the last 20 stderr lines.
 * - `sessionReset` is true on the first result after a live session was lost, false otherwise.
 *
 * Every effect (probe, provision, repair, spawn, clock) is injectable so the unit tests run with a fake host.
 *
 * See change: add-blender-wasm-mcp (design D6, task 3.4).
 */
import { randomBytes } from "node:crypto";
import { type ChildProcess, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { ToolError } from "../errors.js";
import { type ProvisionDeps, type ProvisionResult, provision, repairAfterBootFailure } from "../provision.js";
import { hostArgv, JSPI_FLAG } from "./entry.js";
import { type ProbeResult, probeJspi } from "./probe.js";
import type {
  HostMessage,
  HostRequest,
  HostResultOk,
  OpArgsMap,
  OpName,
  ToolErrorCode,
} from "./protocol.js";

export const MAX_QUEUE_DEPTH = 32;
export const DEFAULT_BOOT_TIMEOUT_MS = 120_000;
export const DEFAULT_IDLE_SEC = 600;
const STDERR_LINES = 20;

export interface Staged {
  files: Record<string, Uint8Array>;
  blend?: Uint8Array;
}

export interface OpRequest<K extends OpName = OpName> {
  op: K;
  args: OpArgsMap[K];
  timeoutSec: number;
  outputLimit: number;
  /** Reads inputs from the workspace at dequeue; may throw a `ToolError` (e.g. `input-not-found`). */
  stage?: () => Promise<Staged>;
}

interface OutcomeBase {
  sessionReset: boolean;
  durationMs: number;
}
export interface OutcomeOk extends OutcomeBase {
  ok: true;
  result: Record<string, unknown>;
  files: HostResultOk["files"];
  output: string;
  outputTruncated: boolean;
}
export interface OutcomeErr extends OutcomeBase {
  ok: false;
  code: ToolErrorCode;
  message: string;
  output?: string;
  outputTruncated?: boolean;
}
export type Outcome = OutcomeOk | OutcomeErr;
/** The call was cancelled: the caller sends no response. */
export interface Cancelled {
  cancelled: true;
}

export interface Call {
  promise: Promise<Outcome | Cancelled>;
  cancel(): void;
}

export interface SupervisorDeps {
  probe(): Promise<ProbeResult>;
  provision(): Promise<ProvisionResult>;
  repair(version: string): Promise<boolean>;
  spawnHost(flags: string[], runtimeDir: string): ChildProcess;
  now(): number;
  nonce(): string;
  idleMs: number;
  bootTimeoutMs: number;
}

export function defaultSupervisorDeps(env: NodeJS.ProcessEnv = process.env, provisionDeps: Partial<ProvisionDeps> = {}): SupervisorDeps {
  const idleSec = Number.parseInt(env.BLENDER_WASM_IDLE_SEC ?? "", 10);
  return {
    probe: () => probeJspi(),
    provision: () => provision(provisionDeps),
    repair: (version) => repairAfterBootFailure(version, provisionDeps),
    spawnHost: (flags, runtimeDir) =>
      spawn(process.execPath, hostArgv(flags, ["--runtime-dir", runtimeDir]), {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "advanced",
      }),
    now: () => Date.now(),
    nonce: () => randomBytes(16).toString("hex"),
    idleMs: (Number.isFinite(idleSec) && idleSec > 0 ? idleSec : DEFAULT_IDLE_SEC) * 1000,
    bootTimeoutMs: DEFAULT_BOOT_TIMEOUT_MS,
  };
}

interface Job {
  req: OpRequest;
  cancelled: boolean;
  /** Set while the job is in flight: aborts whatever it is waiting on. */
  abort?: () => void;
  resolve(o: Outcome | Cancelled): void;
}

class CancelledError extends Error {}

export class Supervisor {
  private readonly deps: SupervisorDeps;
  private child: ChildProcess | undefined;
  private live = false;
  private lost = false;
  private jspi: ProbeResult | undefined;
  private runtime: ProvisionResult | undefined;
  private readonly queue: Job[] = [];
  private running: Job | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 0;
  private stderr: string[] = [];
  private stopped = false;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
  }

  /** Consume the reset flag for a result the supervisor did not produce (e.g. argument validation). */
  takeReset(): boolean {
    const r = this.lost;
    this.lost = false;
    return r;
  }

  enqueue(req: OpRequest): Call {
    let resolve!: (o: Outcome | Cancelled) => void;
    const promise = new Promise<Outcome | Cancelled>((r) => {
      resolve = r;
    });
    const job: Job = { req, cancelled: false, resolve };
    if (this.stopped) {
      resolve(this.failure("session-crashed", "server is shutting down", this.deps.now(), false));
      return { promise, cancel() {} };
    }
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      resolve({ ok: false, code: "limit-exceeded", message: `more than ${MAX_QUEUE_DEPTH} calls are queued`, sessionReset: false, durationMs: 0 });
      return { promise, cancel() {} };
    }
    this.queue.push(job);
    this.clearIdle();
    void this.pump();
    return { promise, cancel: () => this.cancel(job) };
  }

  /** Kill the host and refuse further calls (server stdin end, SIGINT/SIGTERM, IPC disconnect). */
  async shutdown(): Promise<void> {
    this.stopped = true;
    this.clearIdle();
    for (const job of this.queue.splice(0)) job.resolve({ cancelled: true });
    this.running?.abort?.();
    await this.killHost();
  }

  // ── queue ────────────────────────────────────────────────────────────────

  private cancel(job: Job): void {
    job.cancelled = true;
    const i = this.queue.indexOf(job);
    if (i >= 0) {
      this.queue.splice(i, 1);
      job.resolve({ cancelled: true });
      this.armIdle();
      return;
    }
    if (this.running === job) job.abort?.();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) {
      this.armIdle();
      return;
    }
    this.running = job;
    this.clearIdle();
    try {
      job.resolve(await this.execute(job));
    } catch (e) {
      job.resolve(this.failure("session-crashed", `internal error: ${(e as Error).message}`, this.deps.now(), false));
    } finally {
      this.running = undefined;
      void this.pump();
    }
  }

  private failure(code: ToolErrorCode, message: string, started: number, sessionReset: boolean, extra: Partial<OutcomeErr> = {}): OutcomeErr {
    return { ok: false, code, message, sessionReset, durationMs: this.deps.now() - started, ...extra };
  }

  // ── one call ─────────────────────────────────────────────────────────────

  private async execute(job: Job): Promise<Outcome | Cancelled> {
    const started = this.deps.now();
    // Captured at dequeue: this call is the first result after a loss; a loss it causes itself is for the next one.
    const reset = this.takeReset();
    try {
      // Inputs are read first: a bad path must not trigger a probe, a download or a boot.
      const staged = job.req.stage ? await job.req.stage() : { files: {} };
      if (job.cancelled) throw new CancelledError();
      await this.ensureLive(job);
      if (job.cancelled) throw new CancelledError();
      return await this.callHost(job, staged, started, reset);
    } catch (e) {
      if (e instanceof CancelledError || job.cancelled) return { cancelled: true };
      if (e instanceof ToolError) return this.failure(e.code, e.message, started, reset);
      throw e;
    }
  }

  private async ensureLive(job: Job): Promise<void> {
    if (this.child && this.live) return;
    this.jspi ??= await this.deps.probe();
    if (job.cancelled || this.stopped) throw new CancelledError();
    if (this.jspi.mode === "unavailable") {
      throw new ToolError(
        "jspi-unavailable",
        `Blender's WebAssembly runtime needs JSPI, which Node ${this.jspi.node} does not provide; use Node 24 or newer.`,
      );
    }
    let runtime: ProvisionResult;
    try {
      runtime = await this.deps.provision();
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      throw new ToolError("provision-failed", `${typeof code === "string" ? `${code}: ` : ""}${(e as Error).message}`);
    }
    if (job.cancelled || this.stopped) throw new CancelledError();
    this.runtime = runtime;
    await this.boot(job, runtime, this.jspi.mode === "flag" ? [JSPI_FLAG] : []);
  }

  private lastLines(): string {
    return this.stderr.length ? this.stderr.join("\n") : "(no diagnostic output)";
  }

  private spawnChild(flags: string[], runtime: ProvisionResult): ChildProcess {
    this.stderr = [];
    const child = this.deps.spawnHost(flags, runtime.dir);
    this.child = child;
    this.live = false;
    let partial = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) this.stderr.push(l);
      if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES);
    });
    child.on("exit", () => {
      if (partial.trim()) this.stderr.push(partial);
      if (this.child !== child) return;
      this.child = undefined;
      if (this.live) this.lost = true;
      this.live = false;
      this.armIdle();
    });
    child.on("error", (e) => this.stderr.push(`could not start the Blender host: ${e.message}`));
    return child;
  }

  private async boot(job: Job, runtime: ProvisionResult, flags: string[]): Promise<void> {
    const child = this.spawnChild(flags, runtime);
    const outcome = await new Promise<"ready" | "exit" | "timeout" | "cancel">((resolve) => {
      const done = (v: "ready" | "exit" | "timeout" | "cancel"): void => {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        job.abort = undefined;
        resolve(v);
      };
      const onMessage = (m: HostMessage): void => {
        if (m?.type === "ready") done("ready");
      };
      const onExit = (): void => done("exit");
      const timer = setTimeout(() => done("timeout"), this.deps.bootTimeoutMs);
      child.on("message", onMessage);
      child.on("exit", onExit);
      job.abort = () => done("cancel");
    });
    if (outcome === "ready") {
      this.live = true;
      return;
    }
    await this.killHost();
    if (outcome === "cancel") throw new CancelledError();
    if (runtime.source !== "override") await this.deps.repair(runtime.version).catch(() => false);
    throw new ToolError(
      "boot-failed",
      `${outcome === "timeout" ? `Blender did not become ready within ${Math.round(this.deps.bootTimeoutMs / 1000)} s` : "the Blender host exited during boot"}:\n${this.lastLines()}`,
    );
  }

  private async callHost(job: Job, staged: Staged, started: number, reset: boolean): Promise<Outcome | Cancelled> {
    const child = this.child;
    if (!child || !this.live) throw new ToolError("session-crashed", "no live Blender session");
    const id = ++this.nextId;
    const nonce = this.deps.nonce();
    const req: HostRequest = {
      type: "op",
      id,
      op: job.req.op,
      args: job.req.args,
      files: staged.files,
      ...(staged.blend ? { blend: staged.blend } : {}),
      nonce,
      outputLimit: job.req.outputLimit,
    };
    type Settled = { kind: "result"; msg: HostMessage & { type: "result" } } | { kind: "exit" } | { kind: "timeout" } | { kind: "cancel" };
    const settled = await new Promise<Settled>((resolve) => {
      const done = (s: Settled): void => {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        job.abort = undefined;
        resolve(s);
      };
      const onMessage = (m: HostMessage): void => {
        if (m?.type === "result" && m.id === id) done({ kind: "result", msg: m });
      };
      const onExit = (): void => done({ kind: "exit" });
      const timer = setTimeout(() => done({ kind: "timeout" }), job.req.timeoutSec * 1000);
      child.on("message", onMessage);
      child.on("exit", onExit);
      job.abort = () => done({ kind: "cancel" });
      child.send(req, (err) => {
        if (err) done({ kind: "exit" });
      });
    });

    if (settled.kind === "result") {
      const m = settled.msg;
      const durationMs = this.deps.now() - started;
      if (m.ok) {
        return { ok: true, result: m.result, files: m.files, output: m.output, outputTruncated: m.outputTruncated, sessionReset: reset, durationMs };
      }
      return { ok: false, code: m.code, message: m.message, output: m.output, outputTruncated: m.outputTruncated, sessionReset: reset, durationMs };
    }
    // Every other path ends the session: the scene is lost.
    this.lost = true;
    if (settled.kind === "exit") {
      await new Promise((r) => setImmediate(r)); // let the stderr tail flush
      return this.failure("session-crashed", `the Blender session ended during the call:\n${this.lastLines()}`, started, reset);
    }
    await this.killHost();
    if (settled.kind === "cancel") return { cancelled: true };
    return this.failure("timeout", `the call exceeded ${job.req.timeoutSec} s; the session was ended`, started, reset);
  }

  // ── child + idle ─────────────────────────────────────────────────────────

  private async killHost(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.live = false;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    child.kill("SIGKILL");
    await exited;
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.stopped || !this.child || !this.live || this.running || this.queue.length > 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.running || this.queue.length > 0) return;
      this.lost = true;
      void this.killHost();
    }, this.deps.idleMs);
    this.idleTimer.unref?.();
  }

  /** Test seam: the runtime the live session booted from. */
  get currentRuntime(): ProvisionResult | undefined {
    return this.runtime;
  }
}
