/**
 * One hook command: `bash -c <command>` through the shared exec wrapper, DETACHED so the whole
 * process group can be killed (a timed-out `npm test` leaves no grandchildren), event JSON on
 * stdin, allowlisted env, both output streams capped at 64 KiB, one timeout on the injected clock.
 * Spawn and tree-kill are injectable (`HookIo`) so tests drive it with a fake clock and fake child.
 * See change: add-agent-teams-templates-hooks.
 */
import { type ChildProcess, spawn as platformSpawn, type SpawnOptions } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { killProcessGroup } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import type { Clock } from "../shared/clock.js";

/** Both output streams are capped at this many bytes; one byte more is an overflow. */
export const HOOK_STREAM_CAP_BYTES = 65_536;
/** SIGTERM → SIGKILL grace of the tree kill. */
export const HOOK_KILL_GRACE_MS = 2000;
/** After `exit`, wait this long (real time) for the pipes to drain before giving up on a descendant holding them. */
const PIPE_DRAIN_GRACE_MS = 200;

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export type KillTreeFn = (pid: number) => Promise<unknown>;

/** Injectable process boundary. */
export interface HookIo {
  spawn: SpawnFn;
  /** Terminate the process tree led by `pid` (SIGTERM, SIGKILL after the grace; `taskkill /T` on Windows). */
  killTree: KillTreeFn;
  /** Source of the allowlisted env values (default `process.env`). */
  env: () => NodeJS.ProcessEnv;
}

export const defaultHookIo: HookIo = {
  spawn: (command, args, options) => platformSpawn(command, args, options),
  killTree: (pid) => killProcessGroup(pid, { timeoutMs: HOOK_KILL_GRACE_MS }).catch(() => undefined),
  env: () => process.env,
};

export interface HookRunSpec {
  command: string;
  cwd: string;
  /** Already-built child env (see `buildHookEnv`). */
  env: Record<string, string>;
  /** Event JSON written to stdin, then closed. */
  stdin: string;
  /** Effective timeout (already capped by the remaining event budget). */
  timeoutMs: number;
}

export type HookRunOutcome = "exit" | "timeout" | "spawn_error" | "aborted";

export interface HookRunResult {
  outcome: HookRunOutcome;
  /** Exit code (`exit` only; `null` when killed by a signal). */
  code: number | null;
  /** First `HOOK_STREAM_CAP_BYTES` of stderr (utf8). */
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  /** Either stream exceeded the cap. */
  overflow: boolean;
  durationMs: number;
  /** `spawn_error` only: the system error code or message. */
  error?: string;
}

export interface HookRunHandle {
  /** Settles with the verdict-relevant result (exit, timeout, spawn error, abort). */
  result: Promise<HookRunResult>;
  /** Settles when the child (tree) is fully reaped; the concurrency slot is held until then. */
  reaped: Promise<void>;
  /** Shutdown: kill the tree and settle `result` as `aborted`. */
  abort(): void;
}

const ALLOWED_ENV = new Set(["PATH", "HOME", "USER", "LANG", "TMPDIR", "SHELL"]);

/** Allowlisted parent env (`PATH, HOME, USER, LANG, LC_*, TMPDIR, SHELL`) plus the `AGENT_TEAMS_*` event variables. */
export function buildHookEnv(source: NodeJS.ProcessEnv, vars: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (ALLOWED_ENV.has(upper) || upper.startsWith("LC_")) env[key] = value;
  }
  return { ...env, ...vars };
}

function failedSpawn(error: string, startedAt: number, clock: Clock): HookRunHandle {
  const result: HookRunResult = { outcome: "spawn_error", code: null, stderr: "", stdoutBytes: 0, stderrBytes: 0, overflow: false, durationMs: clock.now() - startedAt, error };
  return { result: Promise.resolve(result), reaped: Promise.resolve(), abort() {} };
}

/** Start one hook. Never throws: a synchronous spawn failure answers `spawn_error`. */
export function startHook(spec: HookRunSpec, io: HookIo, clock: Clock): HookRunHandle {
  const startedAt = clock.now();
  let child: ChildProcess;
  try {
    child = io.spawn("bash", ["-c", spec.command], { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
  } catch (err) {
    return failedSpawn((err as NodeJS.ErrnoException).code ?? (err as Error).message, startedAt, clock);
  }

  let settled = false;
  let exitSeen = false;
  let exitCode: number | null = null;
  let killing: Promise<unknown> | undefined;
  let resolveResult!: (r: HookRunResult) => void;
  let resolveReaped!: () => void;
  const result = new Promise<HookRunResult>((r) => (resolveResult = r));
  const reaped = new Promise<void>((r) => (resolveReaped = r));

  const stderrChunks: Buffer[] = [];
  let stderrKept = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflow = false;
  let timer: unknown;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  const killTree = (): Promise<unknown> => {
    killing ??= child.pid !== undefined ? io.killTree(child.pid).catch(() => undefined) : Promise.resolve();
    return killing;
  };
  const markReaped = (): void => void (killing ?? Promise.resolve()).then(resolveReaped, resolveReaped);
  const settle = (outcome: HookRunOutcome, code: number | null, extra: Partial<HookRunResult> = {}): void => {
    if (settled) return;
    settled = true;
    clock.clearTimeout(timer);
    resolveResult({
      outcome,
      code,
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      stdoutBytes,
      stderrBytes,
      overflow,
      durationMs: clock.now() - startedAt,
      ...extra,
    });
  };
  /** Timeout / abort: the verdict is already out; the slot is released once the kill has settled. */
  const killAndRelease = (outcome: "timeout" | "aborted"): void => {
    settle(outcome, null); // the verdict first: a kill that ends the child synchronously must not turn it into an `exit`
    void killTree().then(resolveReaped, resolveReaped);
  };

  child.stdout?.on("data", (b: Buffer) => {
    stdoutBytes += b.length;
    if (stdoutBytes > HOOK_STREAM_CAP_BYTES) overflow = true;
  });
  child.stderr?.on("data", (b: Buffer) => {
    stderrBytes += b.length;
    if (stderrBytes > HOOK_STREAM_CAP_BYTES) overflow = true;
    const room = HOOK_STREAM_CAP_BYTES - stderrKept;
    if (room > 0) {
      const part = b.length > room ? b.subarray(0, room) : b;
      stderrChunks.push(part);
      stderrKept += part.length;
    }
  });
  child.stdin?.on("error", () => {}); // a hook that never reads stdin: EPIPE is not an error
  child.stdin?.end(spec.stdin);

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (child.pid !== undefined) return; // not a failed start (e.g. a failed kill)
    settle("spawn_error", null, { error: err.code ?? err.message });
    resolveReaped();
  });

  const finishExit = (): void => {
    if (drainTimer) clearTimeout(drainTimer);
    if (overflow) void killTree(); // reap descendants that kept writing
    settle("exit", exitCode);
    markReaped();
  };
  child.on("exit", (code) => {
    exitSeen = true;
    exitCode = code;
    // Let the pipes drain (`close`); a descendant holding them open must not stall the verdict.
    drainTimer = setTimeout(finishExit, PIPE_DRAIN_GRACE_MS);
  });
  child.on("close", (code) => {
    if (!exitSeen) exitCode = code;
    finishExit();
  });

  timer = clock.setTimeout(() => killAndRelease("timeout"), Math.max(0, spec.timeoutMs));

  return {
    result,
    reaped,
    abort() {
      if (settled) void killTree();
      else killAndRelease("aborted");
    },
  };
}

/** Decode-safe `first n code points`. */
export function firstChars(text: string, n: number): string {
  if (text.length <= n) return text;
  return Array.from(text).slice(0, n).join("");
}
