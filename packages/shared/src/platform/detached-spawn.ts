/**
 * OS-aware detached-child spawn primitives.
 *
 * The dashboard spawns several kinds of long-lived detached children
 * (pi sessions, dashboard server from Electron or bridge, CLI restart
 * orchestrator) and every site re-implemented the same spawn-then-wait
 * dance with slightly different defaults — producing lifecycle bugs on
 * Windows (children in the parent's libuv kill-on-close job → die on
 * restart) and ~200 LOC of near-duplicated boilerplate. This module
 * consolidates them into three primitives:
 *
 *   • spawnDetached    — spawn with libuv-correct defaults
 *   • waitForNoCrash   — did the child survive a fixed window?
 *   • waitForReady     — did the child pass a positive probe?
 *
 * Key invariants (see change: consolidate-windows-spawn-and-platform-handlers):
 *
 *   1. `detached: true` on every platform. On Windows, libuv only excludes
 *      a child from the parent's global Job Object (which has
 *      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) when `detached: true` — that is
 *      the PGID-equivalent mechanism, and it is the correct default for
 *      every detached-child we spawn.
 *   2. `shell: false` always. `.cmd` shims must be pre-resolved to
 *      `node.exe + cli.js` by the caller (via ToolResolver.resolvePi /
 *      resolveTsx etc.). `shell: true + detached + windowsHide + .cmd`
 *      triggers Node issue #21825 (flashing console window).
 *   3. `stdio[0] = "ignore"` always. A parent-owned pipe breaks when the
 *      parent dies (EPIPE on first write); file fds survive.
 *   4. `windowsHide: true` always (defence in depth alongside detached).
 *
 * All OS-dependent helpers accept an optional trailing
 * `platform: NodeJS.Platform` parameter so tests can exercise both branches
 * without mutating `process.platform`. See AGENTS.md invariant.
 */
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn as safeSpawn } from "./exec.js";

// ── spawnDetached ───────────────────────────────────────────────────────────

export interface SpawnDetachedOptions {
  /** Absolute path to the binary. MUST be pre-resolved — no `.cmd` shims. */
  cmd: string;
  /** Argv tokens. Passed verbatim to `spawn()`; no shell interpretation. */
  args: string[];
  /** Working directory for the child. */
  cwd?: string;
  /** Environment for the child. Defaults to `process.env` via Node. */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional file descriptor for stderr. When omitted, stderr is "ignore".
   * Caller is responsible for `fs.openSync(logPath, "a")` and closing the
   * parent's copy after spawn (the child retains its dup via stdio
   * inheritance). File fds survive parent death; pipes do not.
   */
  logFd?: number;
  /**
   * stdin mode. Default: "ignore" — child's stdin closes immediately.
   *
   * Use `"pipe"` when the child is a Node program whose RPC mode
   * listens for stdin `end` events and shuts down on EOF (e.g.
   * pi-coding-agent's `--mode rpc`). A parent-held pipe keeps the
   * child's stdin open as long as the parent is alive. Note: when
   * the parent process dies, Windows closes the pipe and the child
   * gets EOF — i.e., stdio:"pipe" undoes the session-survives-
   * server-restart invariant of `detached: true`. Callers must pick
   * one property (durability vs RPC-mode keep-alive) consciously.
   */
  stdinMode?: "ignore" | "pipe";
  /**
   * Whether to detach the child from the parent's libuv Job Object
   * (Windows) / process group (POSIX). Default: `true`.
   *
   * When `true` (default):
   *   - Windows: child is excluded from the parent's Job Object, so
   *     killing the parent does NOT kill the child. Downside: libuv
   *     allocates a new console for the child unless all stdio slots
   *     are "ignore" (see libuv `src/win/process.c` — `CREATE_NO_WINDOW`
   *     is only set when no stdio slot has `UV_INHERIT_FD`). With a
   *     parent-held stdin pipe or file-fd stdout/stderr, brief console
   *     flashes occur despite `windowsHide: true` (which only applies
   *     `SW_HIDE` — hides AFTER allocation).
   *   - POSIX: child is placed in its own process group.
   *
   * When `false`:
   *   - Windows: child stays in parent's Job Object. `CREATE_NO_WINDOW`
   *     is irrelevant (no new console allocation). No flash regardless
   *     of stdio shape. Child dies with parent (Job Object closure).
   *   - POSIX: child inherits parent's process group. Child dies with
   *     parent on SIGTERM to the group.
   *
   * Use `false` when the child's lifecycle is deliberately tied to the
   * parent (e.g., pi-session spawn where RPC stdin-EOF already ties
   * them). Use default (`true`) for everything that must outlive its
   * parent (server auto-start, CLI daemon, Electron server launch).
   *
   * See change: prep-for-develop-merge (restores the behavior of
   * commit d331850 that was silently overridden by 5ab7956's universal
   * detached:true invariant).
   */
  detach?: boolean;
  /**
   * Override platform for testing. Does not affect spawn behaviour (Node's
   * `spawn` is platform-aware internally) but is surfaced here so future
   * platform-specific branches stay out of callers.
   */
  platform?: NodeJS.Platform;
}

export interface SpawnDetachedResult {
  ok: boolean;
  pid?: number;
  process?: ChildProcess;
  error?: string;
}

/**
 * Spawn a detached child with libuv-correct defaults on every platform.
 *
 * Returns `{ ok: true, pid, process }` on success. Returns `{ ok: false,
 * error }` when the child has no PID or fails synchronously. Async errors
 * are surfaced via a short (200 ms) grace period: if `ok: false` is
 * returned, either the child never started or it errored immediately.
 */
export async function spawnDetached(opts: SpawnDetachedOptions): Promise<SpawnDetachedResult> {
  const stdioIn: "ignore" | "pipe" = opts.stdinMode ?? "ignore";
  const stdio: ("ignore" | "pipe" | number)[] = [stdioIn, "ignore", opts.logFd ?? "ignore"];

  let child: ChildProcess;
  let spawnError: string | null = null;
  try {
    child = safeSpawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: opts.detach ?? true,
      stdio,
      shell: false,
      windowsHide: true,
    } as SpawnOptions);
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  child.on("error", (err: Error) => {
    spawnError = err.message;
  });

  // unref() so Node's event loop doesn't keep the parent alive because of
  // this child. Harmless when the child has its own stdio file fds.
  try { child.unref(); } catch { /* ignore */ }

  // Short grace window for synchronous / near-synchronous spawn errors
  // (ENOENT is emitted via 'error' on nextTick, not thrown).
  if (!child.pid) {
    await delay(200);
    return { ok: false, error: spawnError ?? "spawn failed: no PID" };
  }

  // If the child errored inside the grace window, surface it even though
  // we have a PID (some failures emit both: PID assigned then ENOENT on
  // the exec itself).
  await delay(5);
  if (spawnError) {
    return { ok: false, error: spawnError, pid: child.pid, process: child };
  }

  return { ok: true, pid: child.pid, process: child };
}

// ── waitForNoCrash ─────────────────────────────────────────────────────────

export interface WaitForNoCrashOptions {
  /** The child returned by spawnDetached(). */
  child: ChildProcess;
  /** How long to wait before declaring "didn't crash" (ms). */
  windowMs: number;
  /**
   * If > 0, capture up to N bytes from the child's stderr stream (if a
   * pipe is attached — which requires stdio[2] to be "pipe" rather than
   * a file fd). Only useful when the caller manually attached a pipe
   * before calling this; `spawnDetached` does NOT use pipes by default.
   */
  captureStderrBytes?: number;
}

export interface WaitForNoCrashResult {
  ok: boolean;
  exitCode?: number | null;
  stderrTail?: string;
}

/**
 * Wait up to `windowMs` milliseconds; return ok:true if the child is
 * still alive at the end, or ok:false if it exited within the window.
 *
 * The primary use case: pi spawn on Windows where we want to catch
 * "pi crashed on startup due to missing module / config error" without
 * blocking the response for the full startup handshake.
 */
export async function waitForNoCrash(opts: WaitForNoCrashOptions): Promise<WaitForNoCrashResult> {
  const { child, windowMs, captureStderrBytes } = opts;

  let stderrBuf = "";
  const cap = captureStderrBytes ?? 0;
  const onStderr = cap > 0 && child.stderr
    ? (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > cap) stderrBuf = stderrBuf.slice(-cap);
      }
    : null;
  if (onStderr) child.stderr!.on("data", onStderr);

  const exitCode = await Promise.race([
    new Promise<number | null>((resolve) => child.once("exit", resolve)),
    delay(windowMs).then(() => undefined),
  ]);

  if (onStderr) child.stderr!.off("data", onStderr);

  if (exitCode === undefined) {
    return { ok: true };
  }
  return {
    ok: false,
    exitCode,
    stderrTail: stderrBuf ? stderrBuf.trim() : undefined,
  };
}

// ── waitForReady ───────────────────────────────────────────────────────────

export interface WaitForReadyOptions {
  /** Called repeatedly until it resolves true, or deadline elapses. */
  probe: () => Promise<boolean>;
  /**
   * Maximum total wait (ms). Omit (or pass `undefined`) to wait
   * indefinitely — in that case the only way to end the wait early is
   * the optional `child` crashing. Use the infinite form when the
   * caller trusts child-exit detection to cover the failure path and
   * doesn't want a false-positive timeout on slow-but-working starts
   * (e.g., cold jiti compile on Windows).
   */
  deadlineMs?: number;
  /** Poll interval (ms). Default 500. */
  pollIntervalMs?: number;
  /**
   * Optional child for early failure detection. If provided, an `error`
   * event or non-zero `exit` short-circuits the wait.
   */
  child?: ChildProcess;
}

export interface WaitForReadyResult {
  ok: boolean;
  error?: string;
}

/**
 * Poll `probe()` until it resolves true, or return timeout / early-failure.
 * When `deadlineMs` is undefined, polls indefinitely until the probe
 * succeeds or the child crashes.
 */
export async function waitForReady(opts: WaitForReadyOptions): Promise<WaitForReadyResult> {
  const { probe, deadlineMs, pollIntervalMs = 500, child } = opts;

  let childError: string | null = null;
  const onError = (err: Error) => { childError = err.message; };
  const onExit = (code: number | null) => {
    if (code !== 0 && code !== null) {
      childError = `child exited with code ${code}`;
    } else if (code === 0) {
      // Exit 0 is fine for short-lived children (e.g., wt.exe). Don't
      // treat it as an error — the probe decides readiness.
    }
  };
  if (child) {
    child.on("error", onError);
    child.on("exit", onExit);
  }

  const deadline = deadlineMs === undefined ? Infinity : Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      if (childError) return { ok: false, error: childError };
      try {
        if (await probe()) return { ok: true };
      } catch {
        // Swallow probe errors — treat as "not ready yet".
      }
      await delay(pollIntervalMs);
    }
    if (childError) return { ok: false, error: childError };
    return { ok: false, error: "timeout" };
  } finally {
    if (child) {
      child.off("error", onError);
      child.off("exit", onExit);
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
