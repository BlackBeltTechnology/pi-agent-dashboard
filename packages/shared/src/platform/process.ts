/**
 * Cross-platform process primitives: port cleanup, kill, liveness, group-kill.
 *
 * Every OS-dependent helper takes an optional `platform` parameter
 * (defaulting to `process.platform`) so tests can exercise both branches
 * without mutating the global `process.platform`. See change:
 * consolidate-platform-handlers.
 */

import fs from "node:fs";
import { win32 as pathWin32 } from "node:path";
import { execFile as defaultExecFile, execSync } from "./exec.js";

export type ExecFn = (cmd: string, opts: { encoding: "utf-8" }) => string;
export type KillFn = (pid: number, signal: NodeJS.Signals | number) => void;

export interface ProcessOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override execSync (for tests). */
  exec?: ExecFn;
  /** Override process.kill (for tests). */
  kill?: KillFn;
}

function defaultExec(cmd: string, opts: { encoding: "utf-8" }): string {
  // Always suppress the cmd.exe window flash on Windows. The primitives that
  // use this (findPortHolders via netstat, killProcess via taskkill) don't
  // need user visibility.
  return execSync(cmd, { ...opts, windowsHide: true }) as unknown as string;
}

function defaultKill(pid: number, signal: NodeJS.Signals | number): void {
  process.kill(pid, signal);
}

// ── Port-holder detection ────────────────────────────────────────────────────

/**
 * Parse `netstat -ano -p tcp` output for PIDs listening on a port (Windows).
 * Pure function, exported for testing.
 *
 * Example input line:
 *   "  TCP    0.0.0.0:8000   0.0.0.0:0   LISTENING   12345"
 */
export function parseNetstatListeners(output: string, port: number, selfPid: number): number[] {
  const pids: number[] = [];
  const portSuffix = `:${port}`;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^\s*TCP/i.test(line)) continue;
    if (!/LISTENING/i.test(line)) continue;
    const cols = trimmed.split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[1];
    if (!local.endsWith(portSuffix)) continue;
    const pid = Number.parseInt(cols[cols.length - 1], 10);
    if (Number.isFinite(pid) && pid > 0 && pid !== selfPid) pids.push(pid);
  }
  return pids;
}

/**
 * Find PIDs holding a TCP port. Cross-platform:
 *   - win32: `netstat -ano -p tcp` → parse LISTENING rows
 *   - unix:  `lsof -t -i :<port> -sTCP:LISTEN`
 *
 * Best-effort: any failure returns []. Excludes the current process PID.
 */
export function findPortHolders(port: number, opts: ProcessOpts = {}): number[] {
  // Integer-range guard: the port is interpolated into a shell string below.
  // See change: triage-codeql-alert-debt (design D3 #30).
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  try {
    if (platform === "win32") {
      const output = exec("netstat -ano -p tcp", { encoding: "utf-8" });
      return parseNetstatListeners(String(output), port, process.pid);
    }
    const output = exec(`lsof -t -i :${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf-8" });
    return String(output).trim().split("\n").map(Number).filter((n) => n > 0 && n !== process.pid);
  } catch {
    return [];
  }
}

// ── Liveness ─────────────────────────────────────────────────────────────────

/**
 * Check whether a PID is alive. Cross-platform via `process.kill(pid, 0)`.
 *
 * Default: any throw (incl. `EPERM`) means "not alive" — unchanged for existing
 * callers. With `epermAlive: true`, `EPERM` (process exists, signal not
 * permitted) counts as ALIVE; only `ESRCH`/other errors mean gone. Use the
 * opt-in when a false "gone" would be unsafe (e.g. before spawning a
 * replacement server). See change: electron-attach-version-skew (D4b).
 */
export function isProcessAlive(pid: number, opts: { kill?: KillFn; epermAlive?: boolean } = {}): boolean {
  const kill = opts.kill ?? defaultKill;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return opts.epermAlive === true && (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

// ── Process start time ───────────────────────────────────────────────────────

/** Linux `USER_HZ`: clock ticks per second in `/proc/<pid>/stat` field 22. */
const USER_HZ = 100;

interface ProcessStartedAtOpts extends ProcessOpts {
  /** Override file reads (for tests). */
  readFile?: (path: string) => string;
}

/**
 * Parse `/proc/<pid>/stat` + `/proc/stat` into an epoch-ms start time.
 * Field 22 (starttime) counts ticks since boot; the comm field (2) may hold
 * spaces and parens, so fields are counted from the LAST `)`. Pure, exported
 * for testing. Returns null when either input is malformed.
 */
function parseProcStartMs(stat: string, procStat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  // After `) ` the next token is field 3 (state), so field 22 is index 19.
  const ticks = Number(stat.slice(close + 1).trim().split(/\s+/)[19]);
  const btime = Number(/^btime\s+(\d+)/m.exec(procStat)?.[1]);
  if (!Number.isFinite(ticks) || !Number.isFinite(btime)) return null;
  return btime * 1000 + Math.round((ticks / USER_HZ) * 1000);
}

/**
 * Epoch-ms start time of `pid`, or null when it cannot be determined.
 *
 * Linux reads `/proc` (the docker image ships no `ps`); other POSIX platforms
 * use `ps -o lstart=`. Windows is unsupported (null). Never throws.
 * See change: fix-gateway-socket-stale-owner (D3).
 */
export function processStartedAt(pid: number, opts: ProcessStartedAtOpts = {}): number | null {
  const platform = opts.platform ?? process.platform;
  if (!Number.isInteger(pid) || pid <= 0 || platform === "win32") return null;
  try {
    if (platform === "linux") {
      const read = opts.readFile ?? ((p: string) => fs.readFileSync(p, "utf8"));
      return parseProcStartMs(read(`/proc/${pid}/stat`), read("/proc/stat"));
    }
    const exec = opts.exec ?? defaultExec;
    const out = String(exec(`LC_ALL=C ps -o lstart= -p ${pid}`, { encoding: "utf-8" })).trim();
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Callback-form `execFile` seam for {@link processStartedAtAsync}. */
export type ExecFileCbFn = (
  file: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeout?: number; windowsHide?: boolean },
  cb: (err: Error | null, stdout: string) => void,
) => void;

/**
 * Async {@link processStartedAt}: same result, but `ps` runs through an async
 * `execFile` (argv, no shell, `LC_ALL=C`, bounded by `timeoutMs`) so a slow or
 * hung `ps` never blocks the event loop — a caller's own timeout can then fire.
 * Linux keeps the synchronous `/proc` read (no subprocess); Windows is null.
 * Never rejects. See change: guard-restored-headless-identity.
 */
export function processStartedAtAsync(
  pid: number,
  opts: { platform?: NodeJS.Platform; readFile?: (path: string) => string; execFile?: ExecFileCbFn; timeoutMs?: number } = {},
): Promise<number | null> {
  const platform = opts.platform ?? process.platform;
  if (!Number.isInteger(pid) || pid <= 0 || platform === "win32") return Promise.resolve(null);
  if (platform === "linux") return Promise.resolve(processStartedAt(pid, { platform, readFile: opts.readFile }));
  const run = opts.execFile ?? (defaultExecFile as unknown as ExecFileCbFn);
  return new Promise((resolve) => {
    try {
      run(
        "ps",
        ["-o", "lstart=", "-p", String(pid)],
        { env: { ...process.env, LC_ALL: "C" }, timeout: opts.timeoutMs ?? 2000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null);
          const ms = Date.parse(String(stdout).trim());
          resolve(Number.isFinite(ms) ? ms : null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/** Outcome of a signal-0 probe, distinguishing PROOF of absence from denial. */
export type SignalZeroOutcome = "alive" | "esrch" | "other-errno";

/**
 * Errno-aware liveness probe for KILL DECISIONS. Unlike `isProcessAlive`
 * (which catches any throw → "dead"), this distinguishes a signal-0 failure
 * by errno: `"esrch"` is PROOF the process does not exist; `"other-errno"`
 * — notably `EPERM` (process alive but owned by another user / hardened) —
 * must read as ALIVE so a caller never terminates a live process on a
 * permission denial. PID reuse on POSIX reads `"alive"` (safe direction:
 * exit deferred, never false).
 * See change: fix-autostart-discovery-precedence (D6).
 */
export function signalZero(pid: number, opts: { kill?: KillFn } = {}): SignalZeroOutcome {
  const kill = opts.kill ?? defaultKill;
  try {
    kill(pid, 0);
    return "alive";
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ESRCH" ? "esrch" : "other-errno";
  }
}

// ── Termination ──────────────────────────────────────────────────────────────

export interface KillProcessResult {
  ok: boolean;
  forced: boolean;
}

/**
 * Own process-group id, cached for the default `exec` only. Only a VALID pgid is
 * cached: a failed lookup (null) is retried on the next call.
 */
let ownPgidCache: number | undefined;

function readOwnPgid(exec: ExecFn): number | null {
  const cacheable = exec === defaultExec;
  if (cacheable && ownPgidCache !== undefined) return ownPgidCache;
  let pgid: number | null = null;
  try {
    const n = Number(String(exec(`ps -o pgid= -p ${process.pid}`, { encoding: "utf-8" })).trim());
    pgid = Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    pgid = null;
  }
  if (cacheable && pgid !== null) ownPgidCache = pgid;
  return pgid;
}

/**
 * POSIX: does `pid` lead its own process group, and is that group NOT ours?
 * Unknown own pgid ⇒ false (fall back to single-pid; never risk our own group).
 */
function leadsForeignGroup(pid: number, kill: KillFn, exec: ExecFn): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (signalZero(-pid, { kill }) === "esrch") return false;
  const own = readOwnPgid(exec);
  return own !== null && own !== pid;
}

/**
 * Terminate a process, cross-platform:
 *   - win32: `taskkill /F /T /PID <pid>` (tree kill, immediate)
 *   - unix, `pid` leads its own (foreign) process group: {@link killProcessGroup}
 *     — SIGTERM → `timeoutMs` → SIGKILL to `-pid`, so children die with it (#912)
 *   - unix, otherwise: SIGTERM → wait up to `timeoutMs` → SIGKILL if still alive
 *
 * Returns `{ ok, forced }`. `ok` is true if the process was terminated (or
 * was already dead); `forced` is true if SIGKILL was needed on Unix.
 */
export async function killProcess(
  pid: number,
  opts: ProcessOpts & { timeoutMs?: number } = {},
): Promise<KillProcessResult> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  const kill = opts.kill ?? defaultKill;
  const timeoutMs = opts.timeoutMs ?? 5000;

  if (!isProcessAlive(pid, { kill })) return { ok: false, forced: false };

  if (platform === "win32") {
    try {
      exec(`taskkill /F /T /PID ${pid}`, { encoding: "utf-8" });
      return { ok: true, forced: false };
    } catch {
      return { ok: false, forced: false };
    }
  }

  if (leadsForeignGroup(pid, kill, exec)) return killProcessGroup(pid, { ...opts, timeoutMs });

  try {
    kill(pid, "SIGTERM");
  } catch {
    return { ok: false, forced: false };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (!isProcessAlive(pid, { kill })) return { ok: true, forced: false };
  }
  try {
    kill(pid, "SIGKILL");
  } catch {
    /* already dead */
  }
  return { ok: true, forced: true };
}

// ── Process-group kill (for detached children) ───────────────────────────────

/**
 * Signal a process, targeting the process group on Unix (negative PID) and
 * the PID directly on Windows. Used for detached children spawned with their
 * own process group.
 */
export function killPidWithGroup(
  pid: number,
  signal: NodeJS.Signals,
  opts: ProcessOpts = {},
): void {
  const platform = opts.platform ?? process.platform;
  const kill = opts.kill ?? defaultKill;
  const target = platform === "win32" ? pid : -pid;
  kill(target, signal);
}

/**
 * Terminate a whole process GROUP led by `pid` (a child spawned detached on
 * POSIX), escalating:
 *   - POSIX: SIGTERM to `-pid` → poll every `pollMs` (200) until no member of
 *     the group is alive or `timeoutMs` (5000) elapses → re-check the group
 *     still exists → SIGKILL to `-pid`, then wait briefly for it to vanish.
 *   - win32: delegates to {@link killProcess} (`taskkill /F /T`).
 *
 * Liveness uses the errno-aware {@link signalZero}: only ESRCH proves the
 * group is gone, so an EPERM member is never mistaken for an exit.
 * Known limit: a worker that called `setsid` left the group and is not reached.
 * See change: add-service-registry-core (D5, command-executor delta).
 */
export async function killProcessGroup(
  pid: number,
  opts: ProcessOpts & { timeoutMs?: number; pollMs?: number } = {},
): Promise<KillProcessResult> {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") return killProcess(pid, opts);
  const kill = opts.kill ?? defaultKill;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pollMs = opts.pollMs ?? 200;
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, forced: false };
  const groupAlive = () => signalZero(-pid, { kill }) !== "esrch";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  if (!groupAlive()) return { ok: false, forced: false };
  try {
    kill(-pid, "SIGTERM");
  } catch {
    if (!groupAlive()) return { ok: true, forced: false };
    return { ok: false, forced: false };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (!groupAlive()) return { ok: true, forced: false };
  }
  // Re-check right before escalating: the group may have drained between the
  // last poll and now, and SIGKILL must never target a vanished group id.
  if (!groupAlive()) return { ok: true, forced: false };
  try {
    kill(-pid, "SIGKILL");
  } catch {
    /* raced to exit */
  }
  const killDeadline = Date.now() + 2000;
  while (groupAlive() && Date.now() < killDeadline) await sleep(50);
  return { ok: !groupAlive(), forced: true };
}

// ── Windows / WSL process identity + verified kill ───────────────────────────
// See change: add-windows-process-identity (D3, D4). Every helper below spawns
// an absolute-path `powershell.exe` / `wsl.exe` through ONE shared limiter and
// validates its inputs BEFORE anything is interpolated into a script.

/** Where a recorded pid lives: the server's own OS, or inside a WSL distribution. */
export type ProcessTarget = { kind: "host" } | { kind: "wsl"; distro: string };

/** Result of a verify-and-kill helper. `error` is NEVER to be read as dead. */
export type VerifyKillResult = "killed" | "mismatch" | "absent" | "error";

/** Tri-state WSL liveness. `unknown` reads as alive. */
export type WslLivenessResult = "alive" | "absent" | "unknown";

/** Async exec seam: resolves stdout on exit 0, rejects otherwise; honours `signal`. */
export type ProcessControlExecFn = (
  file: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; signal: AbortSignal; windowsHide: true },
) => Promise<string | { stdout: string }>;

export interface ProcessControlOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override env (defaults to process.env); only `SystemRoot` is read. */
  env?: NodeJS.ProcessEnv;
  /** Override the async exec (for tests). */
  execFile?: ProcessControlExecFn;
}

/** Concurrent PowerShell / `wsl.exe` invocations allowed per server (W5). */
const PROCESS_CONTROL_SLOTS = 2;
/** Extra wrapper time a verify-and-kill gets for the in-script TERM → KILL ladder (W12). */
const KILL_LADDER_GRACE_MS = 10_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_KILL_TIMEOUT_MS = 5_000;
const MAX_PID = 4_294_967_295;

let inFlight = 0;
const waiters: Array<() => void> = [];

/** Test hook: drop all limiter state (slots and queued waiters). */
export function resetProcessControlLimiter(): void {
  inFlight = 0;
  waiters.length = 0;
}

function acquireSlot(): Promise<void> {
  if (inFlight < PROCESS_CONTROL_SLOTS) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next(); // the slot passes straight to the next waiter (FIFO)
  else inFlight = Math.max(0, inFlight - 1);
}

function defaultProcessControlExec(
  file: string,
  args: string[],
  o: { env: NodeJS.ProcessEnv; signal: AbortSignal; windowsHide: true },
): Promise<string> {
  return new Promise((resolve, reject) => {
    defaultExecFile(
      file,
      args,
      { encoding: "utf8", env: o.env, signal: o.signal, windowsHide: o.windowsHide, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });
}

/**
 * Run `file args` under the shared limiter. `timeoutMs` starts at slot
 * acquisition (queue wait never consumes it). Resolves the raw stdout, or
 * `null` on any failure, timeout or rejection. Never rejects.
 */
async function runLimited(
  file: string,
  args: string[],
  timeoutMs: number,
  opts: ProcessControlOpts,
): Promise<string | null> {
  await acquireSlot();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = opts.execFile ?? defaultProcessControlExec;
    const exec = Promise.resolve()
      .then(() => run(file, args, { env: opts.env ?? process.env, signal: controller.signal, windowsHide: true }))
      .then((r) => (typeof r === "string" ? r : String(r?.stdout ?? "")));
    exec.catch(() => undefined); // a late rejection after a timeout is not an unhandled one
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    return await Promise.race([exec, timeout]).catch(() => null);
  } finally {
    if (timer) clearTimeout(timer);
    releaseSlot();
  }
}

/** Floor a validated non-negative number to a plain decimal integer (never exponent form). */
function safeInt(n: number): number {
  return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER);
}

function validPid(pid: unknown): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid >= 1 && pid <= MAX_PID;
}

function validDistro(distro: unknown): distro is string {
  return typeof distro === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(distro) && !distro.startsWith("-");
}

function validTarget(target: unknown): target is ProcessTarget {
  if (!target || typeof target !== "object") return false;
  const t = target as { kind?: unknown; distro?: unknown };
  return t.kind === "host" || (t.kind === "wsl" && validDistro(t.distro));
}

function nonNegFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function validTimeout(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Absolute `%SystemRoot%\System32\<rel>`, or null when SystemRoot is missing/relative. */
function systemExe(env: NodeJS.ProcessEnv, rel: string): string | null {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.systemroot;
  if (typeof root !== "string" || root === "" || !pathWin32.isAbsolute(root)) return null;
  return pathWin32.join(root, "System32", rel);
}

const POWERSHELL_REL = "WindowsPowerShell\\v1.0\\powershell.exe";
const PS_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"];

function powershellInvocation(opts: ProcessControlOpts, script: string): { file: string; args: string[] } | null {
  if ((opts.platform ?? process.platform) !== "win32") return null;
  const file = systemExe(opts.env ?? process.env, POWERSHELL_REL);
  return file ? { file, args: [...PS_FLAGS, script] } : null;
}

function wslInvocation(opts: ProcessControlOpts, distro: string, script: string): { file: string; args: string[] } | null {
  if ((opts.platform ?? process.platform) !== "win32") return null;
  const file = systemExe(opts.env ?? process.env, "wsl.exe");
  return file ? { file, args: ["-d", distro, "--exec", "sh", "-c", script] } : null;
}

/** The trimmed stdout, exactly one of `markers`, else null (W10: any noise is an error). */
function exactMarker<T extends string>(stdout: string | null, markers: readonly T[]): T | null {
  if (stdout === null) return null;
  const t = stdout.trim();
  return (markers as readonly string[]).includes(t) ? (t as T) : null;
}

// PowerShell scripts: single quoted tokens only, numeric values interpolated
// AFTER validation. `$null = $p.Handle` pins the process handle so Windows
// cannot recycle the pid while the check and the kill run (D4).
const PS_START_MS = "[DateTimeOffset]::new($p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()";

function psProbeScript(pid: number): string {
  return `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $p) { ${PS_START_MS} }`;
}

function psVerifyKillScript(pid: number, maxStartMs: number): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `try { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { 'absent'; exit 0 }",
    "$null = $p.Handle",
    `$s = ${PS_START_MS}`,
    `if ($s -gt ${safeInt(maxStartMs)}) { 'mismatch'; exit 0 }`,
    `taskkill /F /T /PID ${pid} | Out-Null`,
    "if ($LASTEXITCODE -ne 0 -and -not $p.HasExited) { exit 1 }",
    "'killed' } catch { exit 1 }",
  ].join("; ");
}

// POSIX `sh` fragments run inside the distribution (`wsl.exe --exec sh -c`).
// No double quotes or backslashes: the string crosses the Windows command line.
const SH_PREAMBLE = "LC_ALL=C; export LC_ALL";
/** Reads /proc/<pid>/stat into `$1..` (field 3 onward, parsed after the LAST `)`); exits 1 when unreadable. */
function shStat(pid: number): string {
  return [`st=$(cat /proc/${pid}/stat 2>/dev/null) || exit 1`, "rest=${st##*) }", "set -- $rest", "[ -n $3 ] || exit 1"].join("; ");
}

/** After {@link shStat}: sets `now_ms` / `start_ms` (both on the WSL clock) or exits 1. */
const SH_AGE = [
  "ticks=${20}",
  "[ -n $ticks ] || exit 1",
  "read up _ < /proc/uptime || exit 1",
  "hz=$(getconf CLK_TCK 2>/dev/null || echo 100)",
  "cs=$(( 1${up#*.} - 100 ))",
  "now_ms=$(( ${up%.*} * 1000 + cs * 10 ))",
  "start_ms=$(( ticks * 1000 / hz ))",
].join("; ");

function shProbeScript(pid: number): string {
  return [SH_PREAMBLE, shStat(pid), SH_AGE, "echo $now_ms $start_ms"].join("; ");
}

/** Prints `alive | absent | unknown` from a `kill -0` under LC_ALL=C. */
function shLivenessScript(pid: number): string {
  return [
    SH_PREAMBLE,
    `e=$(kill -0 ${pid} 2>&1)`,
    "case $e in '') echo alive;; *'No such process'*) echo absent;; *) echo unknown;; esac",
  ].join("; ");
}

function shVerifyKillScript(pid: number, minAgeMs: number | undefined, timeoutMs: number): string {
  const polls = Math.max(1, Math.ceil(timeoutMs / 200));
  const parts = [
    SH_PREAMBLE,
    `e=$(kill -0 ${pid} 2>&1)`,
    "case $e in '') ;; *'No such process'*) echo absent; exit 0;; *) exit 1;; esac",
    shStat(pid),
  ];
  if (minAgeMs !== undefined) {
    parts.push(SH_AGE, `age_ms=$(( now_ms - start_ms ))`, `[ $age_ms -ge ${safeInt(minAgeMs)} ] || { echo mismatch; exit 0; }`);
  }
  // dash rejects `kill -SIG -- -N` (`--` then a negative number): pass `-N` right after the signal.
  // Only an explicit "No such process" counts as gone; any other kill error is NOT read as dead.
  parts.push(
    // group-aware: only a group leader (pgrp == pid, /proc/<pid>/stat field 5) gets a group signal
    "pg=$3",
    `if [ $pg = ${pid} ]; then t=-${pid}; else t=${pid}; fi`,
    // a non-leader zombie (state Z, awaiting its parent's wait) is already dead
    `alive() { r=$(kill -0 $t 2>&1); case $r in '') ;; *'No such process'*) return 1;; esac; [ $pg != ${pid} ] || return 0; z=$(cat /proc/${pid}/stat 2>/dev/null); zr=\${z##*) }; case $zr in Z*) return 1;; esac; return 0; }`,
    "e=$(kill -TERM $t 2>&1)",
    "case $e in '') ;; *'No such process'*) echo absent; exit 0;; *) exit 1;; esac",
    `i=0; while [ $i -lt ${polls} ]; do alive || { echo killed; exit 0; }; sleep 0.2; i=$((i+1)); done`,
    "kill -KILL $t 2>/dev/null",
    "i=0; while [ $i -lt 10 ]; do alive || { echo killed; exit 0; }; sleep 0.2; i=$((i+1)); done",
    "exit 1",
  );
  return parts.join("; ");
}

/**
 * Epoch-ms start time of `pid` on `target`, or null when it cannot be determined
 * (dead pid, invalid input, wrong platform, timeout, wedged helper). Never throws.
 *
 * - win32 host: PowerShell `Get-Process` `.StartTime` (exact to the ms).
 * - POSIX host: {@link processStartedAt}.
 * - WSL `D`: the process AGE measured inside `D` carried onto the server clock
 *   (`Date.now() − age`), so WSL ↔ Windows clock skew cancels out.
 *
 * Counts against the shared limiter (win32 / WSL only). See change:
 * add-windows-process-identity.
 */
export async function probeProcessStart(
  pid: number,
  target: ProcessTarget,
  opts: ProcessControlOpts & { timeoutMs?: number; processStartedAt?: (pid: number) => number | null | Promise<number | null> } = {},
): Promise<number | null> {
  if (!validPid(pid) || !validTarget(target)) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  if (!validTimeout(timeoutMs)) return null;
  const platform = opts.platform ?? process.platform;
  if (target.kind === "host" && platform !== "win32") {
    try {
      return await (opts.processStartedAt
        ? opts.processStartedAt(pid)
        : processStartedAtAsync(pid, { platform, timeoutMs }));
    } catch {
      return null;
    }
  }
  if (target.kind === "host") {
    const inv = powershellInvocation(opts, psProbeScript(pid));
    if (!inv) return null;
    const out = await runLimited(inv.file, inv.args, timeoutMs, opts);
    const t = out?.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    const ms = Number(t);
    return Number.isSafeInteger(ms) ? ms : null;
  }
  const inv = wslInvocation(opts, target.distro, shProbeScript(pid));
  if (!inv) return null;
  const out = await runLimited(inv.file, inv.args, timeoutMs, opts);
  const sampledAt = Date.now();
  const m = out === null ? null : /^(\d+) (\d+)$/.exec(out.trim());
  if (!m) return null;
  const age = Number(m[1]) - Number(m[2]);
  if (!Number.isFinite(age) || age < 0) return null;
  return sampledAt - age;
}

/**
 * Verify identity and kill the process tree of `pid` in ONE PowerShell
 * invocation (win32 host only): the handle is pinned, `StartTime ≤ maxStartMs`
 * is checked, then `taskkill /F /T` runs while the handle is still open — so
 * pid reuse cannot redirect the kill. `error` is never to be read as dead.
 * See change: add-windows-process-identity (D4).
 */
export async function verifyAndKillWindows(
  pid: number,
  opts: ProcessControlOpts & { maxStartMs: number; timeoutMs?: number },
): Promise<VerifyKillResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
  if (!validPid(pid) || !nonNegFinite(opts?.maxStartMs) || !validTimeout(timeoutMs)) return "error";
  const inv = powershellInvocation(opts, psVerifyKillScript(pid, opts.maxStartMs));
  if (!inv) return "error";
  const out = await runLimited(inv.file, inv.args, timeoutMs + KILL_LADDER_GRACE_MS, opts);
  return exactMarker(out, ["killed", "mismatch", "absent"] as const) ?? "error";
}

/**
 * Tri-state liveness of a WSL pid, decided ONLY inside the distribution.
 * `absent` only on the script's explicit marker; any failure/timeout is
 * `unknown`, which reads as alive. See change: add-windows-process-identity.
 */
export async function wslLiveness(
  pid: number,
  distro: string,
  opts: ProcessControlOpts & { timeoutMs?: number } = {},
): Promise<WslLivenessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  if (!validPid(pid) || !validDistro(distro) || !validTimeout(timeoutMs)) return "unknown";
  const inv = wslInvocation(opts, distro, shLivenessScript(pid));
  if (!inv) return "unknown";
  const out = await runLimited(inv.file, inv.args, timeoutMs, opts);
  return exactMarker(out, ["alive", "absent"] as const) ?? "unknown";
}

/**
 * Verify identity and kill `pid` inside WSL distribution `distro` in ONE
 * `sh -c`: optional age check (`minAgeMs`, an AGE not a time, so clock skew is
 * irrelevant), then a group-aware SIGTERM → poll → SIGKILL. The group leader is
 * read from `/proc/<pid>/stat` (no `ps`). `error` is never to be read as dead.
 * Residual: the few ms between the in-script check and `kill` inside one shell.
 * See change: add-windows-process-identity (D4).
 */
export async function verifyAndKillWsl(
  pid: number,
  distro: string,
  opts: ProcessControlOpts & { minAgeMs?: number; timeoutMs?: number } = {},
): Promise<VerifyKillResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
  if (!validPid(pid) || !validDistro(distro) || !validTimeout(timeoutMs)) return "error";
  if (opts.minAgeMs !== undefined && !nonNegFinite(opts.minAgeMs)) return "error";
  const inv = wslInvocation(opts, distro, shVerifyKillScript(pid, opts.minAgeMs, timeoutMs));
  if (!inv) return "error";
  const out = await runLimited(inv.file, inv.args, timeoutMs + KILL_LADDER_GRACE_MS, opts);
  return exactMarker(out, ["killed", "mismatch", "absent"] as const) ?? "error";
}
