/**
 * `DedicatedChrome` — supervisor of the dashboard-owned Chrome (the "dedicated
 * agent browser"). Spawns Chrome with `--remote-debugging-pipe`, owns the pipe,
 * the data dir, the owner record and the process lifetime. It knows nothing of
 * CDP routing, deny-lists or audit: a later layer (`DedicatedInstance`) builds
 * on the public surface below.
 *
 * PUBLIC SURFACE
 *   new DedicatedChrome(deps: DedicatedChromeDeps)      // `resolveBinary` required, rest injectable
 *   dataDir: string                  // <getDashboardConfigDir()>/agent-chrome (0700)
 *   downloadsDir: string             // <getDashboardConfigDir()>/agent-chrome-downloads
 *   state(): "not-created"|"stopped"|"starting"|"running"
 *   ensureRunning(): Promise<void>   // single-flight; rejects DedicatedChromeError
 *                                    //   .code ∈ "profile-in-use"|"launch-failed"|"owned-by-other-server"
 *   send(msg: object): void          // NUL-terminated JSON to fd3; throws code "not-running" without a pipe
 *   onMessage(cb: (msg: unknown) => void): () => void   // parsed frames from fd4 (split/merged chunks ok)
 *   onExit(cb: (info: ChromeExitInfo) => void): () => void
 *   stop(): Promise<void>            // Browser.close, 5 s grace, then killProcessGroup
 *   reset(): Promise<void>           // delete dataDir; only while stopped, else code "not-stopped"
 *   sizeBytes(): Promise<number | undefined>   // du of dataDir, cached ≤ 1/min; undefined when not-created
 *   lastUsed: number | undefined     // epoch ms of the last `touch()`
 *   touch(): void
 *   pid: number | undefined
 *
 * CONTRACTS
 *   - Server-owned commands use ids ≥ CHROME_INTERNAL_ID_BASE (2_000_000_000) and their replies
 *     are consumed here, never delivered to `onMessage`. Callers must keep their own ids below it.
 *   - `onExit` fires once per Chrome process, for expected (stop) and unexpected exits alike
 *     (`info.expected`); the caller closes the live instance with `closed:chrome-exited` when
 *     `!info.expected`. By then the owner record is cleared and `state()` is `"stopped"`.
 *   - Pipe EOF with the process still alive waits PIPE_EOF_GRACE_MS for the exit (Chrome flushes
 *     its profile after closing the pipe), then group-kills.
 *   - After the first `Browser.getVersion` reply the server sets the download dir itself
 *     (`Browser.setDownloadBehavior`); a failure there fails the launch.
 *   - The server never deletes Chrome lock files.
 *
 * See change: add-dedicated-agent-browser (D1, D2, D3).
 */
import nodeFs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { spawn as realSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  isProcessAlive as realIsProcessAlive,
  killProcessGroup as realKillProcessGroup,
  processStartedAt as realProcessStartedAt,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { encodeFrame, NulFrameDecoder } from "./pipe-framing.js";
import { classifyProcesses, type ProcessInfo, listProcesses as realListProcesses } from "./process-identity.js";

export type DedicatedChromeState = "not-created" | "stopped" | "starting" | "running";
export type DedicatedChromeErrorCode =
  | "profile-in-use"
  | "launch-failed"
  | "owned-by-other-server"
  | "not-stopped"
  | "not-running";

export class DedicatedChromeError extends Error {
  readonly code: DedicatedChromeErrorCode;
  constructor(code: DedicatedChromeErrorCode, message: string) {
    super(message);
    this.name = "DedicatedChromeError";
    this.code = code;
  }
}

export interface ChromeExitInfo {
  code: number | null;
  signal: string | null;
  /** True when `stop()` (or a failed launch) caused it; false for user close / crash. */
  expected: boolean;
  reason: "exit" | "pipe-eof" | "killed" | "spawn-error";
}

/** Server-owned command ids start here; `DedicatedInstance` keeps client ids below. */
export const CHROME_INTERNAL_ID_BASE = 2_000_000_000;
const LAUNCH_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 5_000;
const PIPE_EOF_GRACE_MS = 2_000;
const SIZE_CACHE_MS = 60_000;
/** Pid-reuse tolerance when comparing a recorded owner start time. */
const START_TIME_TOLERANCE_MS = 2_000;

export const CHROME_STDIO: ["ignore", "ignore", "ignore", "pipe", "pipe"] = ["ignore", "ignore", "ignore", "pipe", "pipe"];

/** Chrome argv (D2). Deliberately: no `--remote-debugging-port`, `--enable-automation`, `--headless`. */
export function buildChromeArgs(dataDir: string): string[] {
  return [
    `--user-data-dir=${dataDir}`,
    "--remote-debugging-pipe",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
}

/** Preferences merged into `<dir>/Default/Preferences` before every launch (D2). */
const SEEDED_PREFERENCES: ReadonlyArray<readonly [readonly string[], boolean]> = [
  [["credentials_enable_service"], false],
  [["profile", "password_manager_enabled"], false],
  [["signin", "allowed"], false],
  [["autofill", "profile_enabled"], false],
];

/** Merge the seeded keys into a parsed Preferences object (unrelated keys kept). */
export function mergeSeededPreferences(prefs: Record<string, unknown>): Record<string, unknown> {
  for (const [keys, value] of SEEDED_PREFERENCES) {
    let node = prefs;
    for (const k of keys.slice(0, -1)) {
      const next = node[k];
      if (!next || typeof next !== "object" || Array.isArray(next)) node[k] = {};
      node = node[k] as Record<string, unknown>;
    }
    node[keys[keys.length - 1]] = value;
  }
  return prefs;
}

export interface OwnerRecord {
  serverPid: number;
  /** Epoch ms; `null` where `processStartedAt` is unsupported (win32). */
  serverStartedAt: number | null;
  /** The owner's command line as the OS lists it (identity fallback when no start time). */
  serverCmd: string;
}

/** Minimal child-process surface (real `ChildProcess` satisfies it). */
export interface ChromeChildLike {
  pid?: number;
  /** Index 3 = writable (commands to Chrome), 4 = readable (messages from Chrome). */
  stdio: readonly unknown[];
  // biome-ignore lint/suspicious/noExplicitAny: mirrors EventEmitter.on
  on(event: string, listener: (...args: any[]) => void): unknown;
}
interface PipeWritable {
  write(chunk: Buffer): unknown;
  on?(event: "error", l: (err: Error) => void): unknown;
}
interface PipeReadable {
  // biome-ignore lint/suspicious/noExplicitAny: mirrors EventEmitter.on
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface DedicatedFs {
  existsSync(p: string): boolean;
  mkdirSync(p: string, o: { recursive: boolean; mode?: number }): unknown;
  chmodSync(p: string, mode: number): void;
  readFileSync(p: string, enc: "utf8"): string;
  writeFileSync(p: string, data: string, o: { mode: number }): void;
  renameSync(a: string, b: string): void;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  promises: {
    readdir(p: string, o: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>;
    lstat(p: string): Promise<{ size: number; isFile(): boolean }>;
  };
}

export interface DedicatedChromeDeps {
  /** Chrome binary path or `null` (sibling `resolveChromeBinary` in capability.ts). */
  resolveBinary: () => string | null;
  spawn?: (
    command: string,
    args: string[],
    options: { stdio: typeof CHROME_STDIO; detached: boolean; windowsHide: boolean },
  ) => ChromeChildLike;
  fs?: DedicatedFs;
  now?: () => number;
  listProcesses?: () => Promise<ProcessInfo[]>;
  killProcessGroup?: (pid: number) => Promise<unknown>;
  isProcessAlive?: (pid: number) => boolean;
  processStartedAt?: (pid: number) => number | null;
  getDashboardConfigDir?: () => string;
  platform?: NodeJS.Platform;
  /** This server's pid (owner record). Default `process.pid`. */
  selfPid?: number;
}

interface Pending {
  resolve(result: unknown): void;
  reject(err: Error): void;
}

type LaunchOutcome =
  | { kind: "ready" }
  | { kind: "timeout" }
  | { kind: "error"; error: Error }
  | { kind: "exited"; info: ChromeExitInfo };

export class DedicatedChrome {
  readonly dataDir: string;
  readonly downloadsDir: string;

  private readonly spawnFn: NonNullable<DedicatedChromeDeps["spawn"]>;
  private readonly fs: DedicatedFs;
  private readonly now: () => number;
  private readonly listProcesses: () => Promise<ProcessInfo[]>;
  private readonly killGroupFn: (pid: number) => Promise<unknown>;
  private readonly alive: (pid: number) => boolean;
  private readonly startedAt: (pid: number) => number | null;
  private readonly platform: NodeJS.Platform;
  private readonly selfPid: number;
  private readonly resolveBinary: () => string | null;

  private child: ChromeChildLike | undefined;
  private mode: "idle" | "starting" | "running" = "idle";
  private launching: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private stopRequested = false;
  private launchWaiter: ((o: LaunchOutcome) => void) | undefined;
  private exitWaiters: Array<() => void> = [];
  private eofTimer: ReturnType<typeof setTimeout> | undefined;
  private fd3: PipeWritable | undefined;
  private decoder = new NulFrameDecoder();
  private nextInternalId = CHROME_INTERNAL_ID_BASE;
  private pending = new Map<number, Pending>();
  private messageListeners = new Set<(msg: unknown) => void>();
  private exitListeners = new Set<(info: ChromeExitInfo) => void>();

  private sizeCache: { at: number; value: number } | undefined;
  private sizePending: Promise<number | undefined> | undefined;
  private sizeGen = 0;
  private _lastUsed: number | undefined;

  constructor(deps: DedicatedChromeDeps) {
    const configDir = (deps.getDashboardConfigDir ?? (() => getDashboardConfigDir()))();
    this.dataDir = path.join(configDir, "agent-chrome");
    this.downloadsDir = path.join(configDir, "agent-chrome-downloads");
    this.resolveBinary = deps.resolveBinary;
    this.spawnFn = deps.spawn ?? ((cmd, args, opts) => realSpawn(cmd, args, opts) as unknown as ChromeChildLike);
    this.fs = deps.fs ?? (nodeFs as unknown as DedicatedFs);
    this.now = deps.now ?? (() => Date.now());
    this.platform = deps.platform ?? process.platform;
    this.listProcesses = deps.listProcesses ?? (() => realListProcesses(this.platform));
    this.killGroupFn = deps.killProcessGroup ?? ((pid) => realKillProcessGroup(pid, { platform: this.platform }));
    this.alive = deps.isProcessAlive ?? ((pid) => realIsProcessAlive(pid));
    this.startedAt = deps.processStartedAt ?? ((pid) => realProcessStartedAt(pid));
    this.selfPid = deps.selfPid ?? process.pid;
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  state(): DedicatedChromeState {
    if (this.mode === "starting" || this.launching !== undefined) return "starting";
    if (this.mode === "running") return "running";
    return this.fs.existsSync(this.dataDir) ? "stopped" : "not-created";
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get lastUsed(): number | undefined {
    return this._lastUsed;
  }

  touch(): void {
    this._lastUsed = this.now();
  }

  onMessage(cb: (msg: unknown) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onExit(cb: (info: ChromeExitInfo) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  send(msg: object): void {
    const w = this.fd3;
    if (!w || !this.child) throw new DedicatedChromeError("not-running", "dedicated Chrome pipe is not open");
    w.write(encodeFrame(msg));
  }

  // ── Launch ────────────────────────────────────────────────────────────────

  /** Single-flight: concurrent callers share one launch. */
  ensureRunning(): Promise<void> {
    if (this.mode === "running" && !this.stopping) return Promise.resolve();
    if (this.launching !== undefined) return this.launching;
    const run = (async () => {
      if (this.stopping !== undefined) await this.stopping.catch(() => {});
      if (this.mode === "running") return;
      this.stopRequested = false;
      await this.launch();
    })();
    const tracked = run.finally(() => {
      if (this.launching === tracked) this.launching = undefined;
    });
    this.launching = tracked;
    return tracked;
  }

  private abortIfStopped(): void {
    if (this.stopRequested) throw new DedicatedChromeError("launch-failed", "launch aborted: Chrome was stopped");
  }

  private async launch(): Promise<void> {
    const list = await this.decideLaunch();
    this.abortIfStopped();

    const binary = this.resolveBinary();
    if (!binary) throw new DedicatedChromeError("launch-failed", "Google Chrome binary not found");

    this.ensureDirs();
    this.seedPreferences();

    let child: ChromeChildLike;
    try {
      child = this.spawnFn(binary, buildChromeArgs(this.dataDir), {
        stdio: CHROME_STDIO,
        // Own process group so helpers die with it (`killProcessGroup`); win32 has no groups.
        detached: this.platform !== "win32",
        windowsHide: false,
      });
    } catch (e) {
      throw new DedicatedChromeError("launch-failed", `failed to start Chrome: ${(e as Error).message}`);
    }
    this.mode = "starting";
    this.attach(child);
    this.writeOwnerRecord(list);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await new Promise<LaunchOutcome>((resolve) => {
      this.launchWaiter = resolve;
      timer = setTimeout(() => resolve({ kind: "timeout" }), LAUNCH_TIMEOUT_MS);
      this.request("Browser.getVersion")
        .then(() =>
          this.request("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: this.downloadsDir }),
        )
        .then(
          () => resolve({ kind: "ready" }),
          (error: Error) => resolve({ kind: "error", error }),
        );
    });
    if (timer) clearTimeout(timer);
    this.launchWaiter = undefined;

    if (outcome.kind === "ready" && !this.stopRequested && this.child === child) {
      this.mode = "running";
      return;
    }
    await this.failLaunch(child, outcome);
  }

  private async failLaunch(child: ChromeChildLike, outcome: LaunchOutcome): Promise<never> {
    if (this.stopRequested) {
      // `stop()` owns the shutdown (grace period, then kill); wait for it to finish.
      if (this.child === child) await new Promise<void>((resolve) => this.exitWaiters.push(resolve));
      throw new DedicatedChromeError("launch-failed", "launch aborted: Chrome was stopped");
    }
    if (outcome.kind === "exited") {
      // Chrome handing off to an already-running instance exits at once; a browser
      // process on our dir that is not our child proves the hand-off.
      const handedOff = await this.foreignOnDir(child.pid);
      if (handedOff) {
        throw new DedicatedChromeError("profile-in-use", "the dedicated profile is already open in a running Chrome");
      }
      const { code, signal } = outcome.info;
      throw new DedicatedChromeError("launch-failed", `Chrome exited before answering (code ${code}, signal ${signal})`);
    }
    await this.killAndFinalize(child);
    const why = outcome.kind === "error" ? outcome.error.message : `no reply within ${LAUNCH_TIMEOUT_MS / 1000}s`;
    throw new DedicatedChromeError("launch-failed", `Chrome did not become ready: ${why}`);
  }

  private async foreignOnDir(ownPid: number | undefined): Promise<boolean> {
    const list = await this.listProcesses();
    const { dedicated, foreign } = classifyProcesses(list, this.dataDir, this.platform);
    return [...dedicated, ...foreign].some((p) => p.pid !== ownPid);
  }

  /** Ownership + identity decision before spawning (design D2). Returns the process listing. */
  private async decideLaunch(): Promise<ProcessInfo[]> {
    if (!this.fs.existsSync(this.dataDir)) return []; // nothing can be using a directory that is absent
    const list = await this.listProcesses();
    this.abortIfStopped();
    const { dedicated, foreign } = classifyProcesses(list, this.dataDir, this.platform);

    if (dedicated.length > 0) {
      const rec = this.readOwnerRecord();
      // Our own pid in the record means a previous incarnation in THIS process (plugin reload):
      // its pipe is gone, so it is an orphan to us.
      if (rec && rec.serverPid !== this.selfPid && this.ownerAlive(rec, list)) {
        throw new DedicatedChromeError("owned-by-other-server", "another dashboard server owns the running dedicated Chrome");
      }
      for (const p of dedicated) await this.killByIdentity(p.pid);
    }
    if (foreign.length > 0) {
      throw new DedicatedChromeError("profile-in-use", "the dedicated profile is already open in a Chrome the dashboard did not start");
    }
    return list;
  }

  private ownerAlive(rec: OwnerRecord, list: readonly ProcessInfo[]): boolean {
    if (!this.alive(rec.serverPid)) return false;
    const ts = this.startedAt(rec.serverPid);
    if (rec.serverStartedAt != null && ts != null) {
      return Math.abs(ts - rec.serverStartedAt) <= START_TIME_TOLERANCE_MS;
    }
    // No usable start time (win32): the pid must still carry the recorded command line.
    const entry = list.find((p) => p.pid === rec.serverPid);
    return !!entry && entry.args === rec.serverCmd;
  }

  /** Kill `pid` only if a FRESH listing still shows it as the dedicated Chrome (pid-reuse guard). */
  private async killByIdentity(pid: number): Promise<void> {
    const fresh = await this.listProcesses();
    const still = classifyProcesses(fresh, this.dataDir, this.platform).dedicated.some((p) => p.pid === pid);
    if (!still) return;
    await this.killGroup(pid);
  }

  private async killGroup(pid: number | undefined): Promise<void> {
    if (pid === undefined) return;
    try {
      await this.killGroupFn(pid);
    } catch {
      /* already gone */
    }
  }

  /** Group-kill `child` and report it gone. `expected`: nobody should read this as a crash. */
  private async killAndFinalize(child: ChromeChildLike, expected = true): Promise<void> {
    await this.killGroup(child.pid);
    this.finalize(child, { code: null, signal: null, reason: "killed", expected });
  }

  // ── Pipe + process events ─────────────────────────────────────────────────

  private attach(child: ChromeChildLike): void {
    this.child = child;
    this.decoder = new NulFrameDecoder();
    const fd3 = child.stdio[3] as PipeWritable | undefined;
    const fd4 = child.stdio[4] as PipeReadable | undefined;
    this.fd3 = fd3;
    fd3?.on?.("error", () => {
      /* EPIPE when Chrome is gone — the exit/EOF handler reports it */
    });
    let exited = false;
    fd4?.on("data", (chunk: Buffer | string) => {
      if (this.child !== child) return;
      for (const frame of this.decoder.push(chunk)) this.dispatch(frame);
    });
    const onEof = () => {
      if (this.child !== child || exited || this.eofTimer) return;
      // Give Chrome time to flush and exit on its own; then take the group down.
      this.eofTimer = setTimeout(() => {
        this.eofTimer = undefined;
        if (this.child !== child) return;
        void this.killGroup(child.pid).then(() => this.finalize(child, { code: null, signal: null, reason: "pipe-eof" }));
      }, PIPE_EOF_GRACE_MS);
    };
    fd4?.on("end", onEof);
    fd4?.on("close", onEof);
    fd4?.on("error", onEof);
    child.on("exit", (code: number | null, signal: string | null) => {
      exited = true;
      this.finalize(child, { code, signal, reason: "exit" });
    });
    child.on("error", (err: Error) => {
      exited = true;
      this.finalize(child, { code: null, signal: null, reason: "spawn-error" }, err);
    });
  }

  private dispatch(frame: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(frame);
    } catch {
      return; // malformed frame: drop, never crash the pipe reader
    }
    const id = (msg as { id?: unknown } | null)?.id;
    if (typeof id === "number" && id >= CHROME_INTERNAL_ID_BASE) {
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        const err = (msg as { error?: { message?: string } }).error;
        if (err) p.reject(new Error(err.message ?? "CDP error"));
        else p.resolve((msg as { result?: unknown }).result);
      }
      return;
    }
    for (const cb of [...this.messageListeners]) {
      try {
        cb(msg);
      } catch {
        /* a listener must not break the reader */
      }
    }
  }

  private request(method: string, params?: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextInternalId++;
      this.pending.set(id, { resolve, reject });
      try {
        this.send(params ? { id, method, params } : { id, method });
      } catch (e) {
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** Once per Chrome process. */
  private finalize(
    child: ChromeChildLike,
    partial: Omit<ChromeExitInfo, "expected"> & { expected?: boolean },
    error?: Error,
  ): void {
    if (this.child !== child) return;
    const info: ChromeExitInfo = { ...partial, expected: partial.expected ?? this.stopRequested };
    this.child = undefined;
    this.fd3 = undefined;
    this.mode = "idle";
    if (this.eofTimer) clearTimeout(this.eofTimer);
    this.eofTimer = undefined;
    this.decoder.reset();
    this.launchWaiter?.(error ? { kind: "error", error } : { kind: "exited", info });
    const failure = error ?? new Error("Chrome exited");
    for (const p of this.pending.values()) p.reject(failure);
    this.pending.clear();
    this.clearOwnerRecord();
    this.sizeGen++;
    this.sizeCache = undefined;
    for (const cb of [...this.exitListeners]) {
      try {
        cb(info);
      } catch {
        /* listener errors never break supervision */
      }
    }
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const w of waiters) w();
  }

  // ── Stop / reset ──────────────────────────────────────────────────────────

  /** Graceful: `Browser.close`, wait up to 5 s, then `killProcessGroup`. */
  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    if (!this.child && this.launching === undefined) return Promise.resolve();
    const run = this.doStop();
    const tracked = run.finally(() => {
      if (this.stopping === tracked) this.stopping = undefined;
    });
    this.stopping = tracked;
    return tracked;
  }

  private async doStop(): Promise<void> {
    this.stopRequested = true;
    // Only a launch already in flight is ours to wait for (a later one waits for US).
    const inflight = this.launching;
    this.sizeGen++;
    this.sizeCache = undefined;
    const child = this.child;
    if (child) {
      try {
        this.send({ id: this.nextInternalId++, method: "Browser.close" });
      } catch {
        /* pipe already gone */
      }
      const exited = await new Promise<boolean>((resolve) => {
        if (this.child !== child) return resolve(true);
        const timer = setTimeout(() => resolve(false), STOP_GRACE_MS);
        this.exitWaiters.push(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (!exited) await this.killAndFinalize(child);
    }
    // A launch still in flight settles (aborted) before stop reports done.
    if (inflight !== undefined) await inflight.catch(() => {});
  }

  /** Delete the dedicated profile; only while Chrome is stopped. */
  async reset(): Promise<void> {
    if (this.mode !== "idle" || this.launching !== undefined || this.stopping !== undefined) {
      throw new DedicatedChromeError("not-stopped", "the dedicated Chrome must be stopped before reset");
    }
    if (this.fs.existsSync(this.dataDir)) {
      // Another server's (or the user's) Chrome on the directory also blocks a reset.
      const { dedicated, foreign } = classifyProcesses(await this.listProcesses(), this.dataDir, this.platform);
      if (dedicated.length + foreign.length > 0) {
        throw new DedicatedChromeError("not-stopped", "a Chrome is still running on the dedicated profile");
      }
    }
    this.fs.rmSync(this.dataDir, { recursive: true, force: true });
    this.sizeGen++;
    this.sizeCache = undefined;
    this._lastUsed = undefined;
  }

  // ── Size ──────────────────────────────────────────────────────────────────

  /** Size of `dataDir` in bytes; cached for a minute, invalidated by stop/reset/exit. */
  sizeBytes(): Promise<number | undefined> {
    if (!this.fs.existsSync(this.dataDir)) return Promise.resolve(undefined);
    if (this.sizeCache && this.now() - this.sizeCache.at < SIZE_CACHE_MS) return Promise.resolve(this.sizeCache.value);
    if (this.sizePending !== undefined) return this.sizePending;
    const gen = this.sizeGen;
    const p = this.walkSize(this.dataDir).then((value) => {
      if (gen === this.sizeGen) this.sizeCache = { at: this.now(), value };
      return value;
    });
    const tracked = p.finally(() => {
      if (this.sizePending === tracked) this.sizePending = undefined;
    });
    this.sizePending = tracked;
    return tracked;
  }

  private async walkSize(dir: string): Promise<number> {
    let total = 0;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await this.fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) total += await this.walkSize(full);
        else {
          const st = await this.fs.promises.lstat(full);
          if (st.isFile()) total += st.size;
        }
      } catch {
        /* vanished mid-walk */
      }
    }
    return total;
  }

  // ── Disk: dirs, preferences, owner record ─────────────────────────────────

  private ensureDirs(): void {
    for (const d of [this.dataDir, this.downloadsDir]) {
      this.fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      if (this.platform !== "win32") this.fs.chmodSync(d, 0o700); // tighten a pre-existing dir too
    }
  }

  /** Merge the seeded keys into `Default/Preferences`, keeping every other key. */
  private seedPreferences(): void {
    const dir = path.join(this.dataDir, "Default");
    const file = path.join(dir, "Preferences");
    this.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let prefs: Record<string, unknown> = {};
    if (this.fs.existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(this.fs.readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prefs = parsed as Record<string, unknown>;
      } catch {
        /* corrupt file: Chrome would reset it anyway */
      }
    }
    this.writeAtomic(file, JSON.stringify(mergeSeededPreferences(prefs)));
  }

  private get ownerFile(): string {
    return path.join(this.dataDir, ".dashboard-owner.json");
  }

  private writeAtomic(file: string, data: string): void {
    const tmp = `${file}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, data, { mode: 0o600 });
    this.fs.renameSync(tmp, file);
  }

  private writeOwnerRecord(list: readonly ProcessInfo[]): void {
    const serverCmd = list.find((p) => p.pid === this.selfPid)?.args ?? [process.execPath, ...process.argv.slice(1)].join(" ");
    const rec: OwnerRecord = {
      serverPid: this.selfPid,
      serverStartedAt: this.startedAt(this.selfPid),
      serverCmd: serverCmd.slice(0, 2048),
    };
    try {
      this.writeAtomic(this.ownerFile, JSON.stringify(rec));
    } catch {
      /* best effort: a missing record only makes a later launch treat Chrome as an orphan */
    }
  }

  private readOwnerRecord(): OwnerRecord | undefined {
    try {
      const rec = JSON.parse(this.fs.readFileSync(this.ownerFile, "utf8")) as Partial<OwnerRecord>;
      if (typeof rec.serverPid !== "number") return undefined;
      return {
        serverPid: rec.serverPid,
        serverStartedAt: typeof rec.serverStartedAt === "number" ? rec.serverStartedAt : null,
        serverCmd: typeof rec.serverCmd === "string" ? rec.serverCmd : "",
      };
    } catch {
      return undefined;
    }
  }

  /** Remove the record only when it is ours (another server's record stays). */
  private clearOwnerRecord(): void {
    const rec = this.readOwnerRecord();
    if (rec && rec.serverPid !== this.selfPid) return;
    try {
      this.fs.rmSync(this.ownerFile, { recursive: false, force: true });
    } catch {
      /* ignore */
    }
  }
}
