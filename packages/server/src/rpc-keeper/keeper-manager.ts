/**
 * KeeperManager — server-side helper for spawning, writing to, killing,
 * and discovering RPC keeper sidecars.
 *
 * One keeper process per headless session. The keeper itself is
 * `keeper.cjs` (CJS-pure). KeeperManager bridges between the dashboard
 * server's TypeScript world and the spawned CJS subprocess.
 *
 * Tasks: 4.1, 4.2, 4.3, 4.4, 4.5.
 * See: openspec/changes/add-rpc-stdin-dispatch-with-keeper-sidecar
 *   - specs/rpc-keeper-sidecar/spec.md (lifecycle + discovery contract)
 *   - design.md Decisions 4 + 8
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  spawnDetached as defaultSpawnDetached,
  type SpawnDetachedOptions,
  type SpawnDetachedResult,
} from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import {
  isProcessAlive,
  killPidWithGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { electronAsNodeRequired } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";

// ── Path conventions ─────────────────────────────────────────────────────────

function defaultSessionsDir(): string {
  // Keeper meta descriptors (UDS socket, .pid sidecar, keeper log) live under
  // <base>/.pi/dashboard/sessions. The base is os.homedir() by default; set
  // PI_DASHBOARD_HOME to relocate it (e.g. to keep the Unix socket path under
  // the sockaddr_un.sun_path limit when the real HOME is deep). This is the only
  // knob — createKeeperManager() flows this dir to both spawn and the startup
  // reconnect scan. Unset in production ⇒ ~/.pi/dashboard/sessions (unchanged).
  const base = process.env.PI_DASHBOARD_HOME?.trim() || os.homedir();
  return path.join(base, ".pi", "dashboard", "sessions");
}

function defaultKeeperPath(): string {
  // `keeper.cjs` sits alongside this module. Works under jiti (source dir)
  // and any preserve-structure build (dist/rpc-keeper/keeper.cjs).
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "keeper.cjs");
}

export function sockPathFor(
  sessionsDir: string,
  sessionId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? `\\\\.\\pipe\\pi-rpc-${sessionId}`
    : path.join(sessionsDir, `${sessionId}.rpc.sock`);
}

export function pidPathFor(
  sessionsDir: string,
  sessionId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? path.join(sessionsDir, `pi-rpc-${sessionId}.pid`)
    : `${sockPathFor(sessionsDir, sessionId, platform)}.pid`;
}

function keeperLogPath(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, `keeper-${sessionId}.log`);
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface KeeperSpawnResult {
  success: boolean;
  /** Keeper process PID. NOT pi's PID (pi PID is linked later via token correlation). */
  pid?: number;
  /** Absolute path to the UDS / named pipe the keeper listens on. */
  sockPath?: string;
  /** Underlying child process handle. */
  process?: ChildProcess;
  /** Error message when `success: false`. */
  error?: string;
}

export interface KeeperEntry {
  sessionId: string;
  keeperPid: number;
  sockPath: string;
}

export interface KeeperManager {
  /**
   * Spawn a keeper for `sessionId`. Resolves once the keeper has a PID.
   *
   * `piArgs` is the pi-side argv tail (e.g. `["--mode","rpc","--session",path]`).
   * `piCmd` is the ToolRegistry-resolved absolute argv for the pi binary
   * (`[exe, ...prefixArgs]`). When provided and non-empty, it is JSON-encoded
   * into the keeper's env as `PI_KEEPER_PI_CMD`; the keeper consumes it and
   * spawns pi via that absolute path instead of bare PATH lookup. When
   * omitted (manual / test invocations), the keeper falls back to bare
   * `spawn("pi", …)`. See change: fix-rpc-keeper-pi-resolution.
   */
  spawnKeeperFor(
    sessionId: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    piArgs?: string[],
    piCmd?: string[],
  ): Promise<KeeperSpawnResult>;
  /** Connect to keeper UDS, write `line + \n`, close. Never throws. */
  writeRpc(sessionId: string, line: string): Promise<boolean>;
  /**
   * Connect to an arbitrary UDS / named-pipe path, write `line + \n`, close.
   * Used by `headless-pid-registry.writeRpc` so the registry can delegate
   * line-write semantics (3-attempt retry with backoffs, never throws)
   * without re-implementing the connect logic. Returns false on all-attempts-failed.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
   */
  writeRpcToSockPath(sockPath: string, line: string): Promise<boolean>;
  /** SIGTERM the keeper PID for `sessionId` (via process-group on Unix). */
  killKeeper(sessionId: string): boolean;
  /** Scan sessions dir; return live keeper+pi pairs; unlink stale entries. */
  discoverExistingKeepers(): Promise<KeeperEntry[]>;
  /**
   * Side-effect-free liveness probe for ONE session: is a keeper process
   * still holding this session's pi? Unlike `discoverExistingKeepers` it
   * neither unlinks stale sidecars nor kills orphans, so it is safe to call
   * on a hot path (the resume guard). See change: fix-recovery-exit-intent.
   */
  isKeeperAlive(sessionId: string): boolean;
  /** For tests / introspection. */
  readonly sessionsDir: string;
}

// ── Dependency-injection options ─────────────────────────────────────────────

export interface KeeperManagerOptions {
  /** Override the sessions dir (default `~/.pi/dashboard/sessions`). */
  sessionsDir?: string;
  /** Override the absolute path to `keeper.cjs`. */
  keeperPath?: string;
  /** Override the node binary used to invoke the keeper (default `process.execPath`). */
  nodeBinary?: string;
  /**
   * Callback used by `discoverExistingKeepers` to verify the corresponding
   * pi process is alive (the keeper-pid liveness is checked internally).
   * Default: always returns true — caller MUST inject a real probe (typically
   * wired to `headlessPidRegistry`) when using `discoverExistingKeepers` for
   * orphan reconciliation.
   */
  isPiAliveForSession?: (sessionId: string, keeperPid: number) => boolean;
  /**
   * Override the OS for path-convention computation. Default: `process.platform`.
   * Only affects socket / pid-sidecar path shape; spawn dispatch is handled
   * inside `spawnDetached` already.
   */
  platform?: NodeJS.Platform;
  /** Test seam — override `spawnDetached`. */
  spawnDetached?: (opts: SpawnDetachedOptions) => Promise<SpawnDetachedResult>;
  /** Test seam — override `net.createConnection`. */
  createConnection?: typeof net.createConnection;
}

// ── Implementation ───────────────────────────────────────────────────────────

/** Per-attempt connect timeout for `writeRpc`. */
const WRITE_RPC_ATTEMPT_TIMEOUT_MS = 350;
/** Backoffs before retry attempts 2 and 3. Task 4.3. */
const WRITE_RPC_RETRY_DELAYS_MS = [50, 150];
/** Total attempts including the initial one. */
const WRITE_RPC_MAX_ATTEMPTS = 3;

export function createKeeperManager(opts: KeeperManagerOptions = {}): KeeperManager {
  const sessionsDir = opts.sessionsDir ?? defaultSessionsDir();
  const keeperPath = opts.keeperPath ?? defaultKeeperPath();
  const nodeBinary = opts.nodeBinary ?? process.execPath;
  const platform = opts.platform ?? process.platform;
  const isPiAlive = opts.isPiAliveForSession ?? (() => true);
  const spawnDetached = opts.spawnDetached ?? defaultSpawnDetached;
  const createConnection = opts.createConnection ?? net.createConnection;

  // sessionId → keeperPid for fast killKeeper without rescanning the dir.
  // (Discovery rebuilds this from the filesystem on startup.)
  const tracked = new Map<string, number>();

  function ensureSessionsDir(): void {
    try { mkdirSync(sessionsDir, { recursive: true }); } catch { /* mkdir failure surfaced by keeper itself */ }
  }

  async function spawnKeeperFor(
    sessionId: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    piArgs?: string[],
    piCmd?: string[],
  ): Promise<KeeperSpawnResult> {
    if (!sessionId || typeof sessionId !== "string") {
      return { success: false, error: "sessionId required" };
    }
    if (!existsSync(keeperPath)) {
      return { success: false, error: `keeper.cjs not found at ${keeperPath}` };
    }
    ensureSessionsDir();

    // Per-spawn log for the parent-side stdio capture. The keeper itself
    // writes its primary log to `keeper-<sid>.log`; this captures any
    // bootstrap stderr (e.g. keeper failed to open its own log).
    const launchLogPath = path.join(sessionsDir, `keeper-launch-${sessionId}.log`);
    let logFd: number | undefined;
    try { logFd = openSync(launchLogPath, "a"); } catch { logFd = undefined; }

    // Forward pi argv to the keeper via env var (avoids shell-quoting
    // pitfalls of stuffing them into argv). Keeper reads PI_KEEPER_PI_ARGS
    // and strips it from pi's env before spawning pi. Defaults to bare RPC
    // when piArgs is omitted, preserving simple test/direct-invocation use.
    //
    // Likewise PI_KEEPER_PI_CMD carries the ToolRegistry-resolved absolute
    // argv for the pi binary; keeper spawns pi via that path instead of bare
    // PATH lookup. Both env vars are stripped by the keeper before spawning
    // pi. See change: fix-rpc-keeper-pi-resolution.
    let keeperEnv: NodeJS.ProcessEnv = env;
    if (piArgs && piArgs.length > 0) {
      keeperEnv = { ...keeperEnv, PI_KEEPER_PI_ARGS: JSON.stringify(piArgs) };
    }
    if (piCmd && piCmd.length > 0) {
      keeperEnv = { ...keeperEnv, PI_KEEPER_PI_CMD: JSON.stringify(piCmd) };
    }

    // Guard the keeper's OWN launch argv `[nodeBinary, keeper.cjs]`. When
    // `nodeBinary` is `process.execPath` under Electron (execpath-fallback
    // topology), it is the Electron GUI binary and only runs `keeper.cjs`
    // as Node with `ELECTRON_RUN_AS_NODE=1`. Independent of the pi argv:
    // this keeps the keeper process itself from re-launching the GUI even
    // if the pi argv did not carry the flag. Shared predicate = one rule.
    // See change: fix-nodescript-argv-electron-execpath-fallback.
    if (electronAsNodeRequired(nodeBinary)) {
      keeperEnv = { ...keeperEnv, ELECTRON_RUN_AS_NODE: "1" };
    }

    // Forward PI_DASHBOARD_HOME explicitly so the keeper child derives the same
    // sessions dir as the server's defaultSessionsDir() — buildSpawnEnv curates
    // the env and may not carry this custom var through on its own.
    if (process.env.PI_DASHBOARD_HOME && process.env.PI_DASHBOARD_HOME.trim()) {
      keeperEnv = { ...keeperEnv, PI_DASHBOARD_HOME: process.env.PI_DASHBOARD_HOME };
    }

    // Delegate to the shared cross-platform primitive so libuv-correct
    // defaults (detached: true on POSIX, Job-Object exclusion + windowsHide
    // on win32) are uniform.
    const r = await spawnDetached({
      cmd: nodeBinary,
      args: [keeperPath, sessionId],
      cwd,
      env: keeperEnv,
      logFd,
      stdinMode: "ignore",
      detach: true,
    });

    if (!r.ok || typeof r.pid !== "number") {
      return { success: false, error: r.error ?? "spawn returned no pid" };
    }

    // Detach: let the keeper continue if this Node process exits.
    try { r.process?.unref(); } catch { /* ignore */ }

    tracked.set(sessionId, r.pid);

    return {
      success: true,
      pid: r.pid,
      sockPath: sockPathFor(sessionsDir, sessionId, platform),
      process: r.process,
    };
  }

  function tryConnectAndWrite(sockPath: string, line: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      let sock: net.Socket;
      try {
        sock = createConnection(sockPath);
      } catch {
        settle(false);
        return;
      }

      const timer = setTimeout(() => {
        try { sock.destroy(); } catch { /* ignore */ }
        settle(false);
      }, timeoutMs);

      sock.once("connect", () => {
        sock.end(line.endsWith("\n") ? line : line + "\n", "utf8", () => {
          clearTimeout(timer);
          settle(true);
        });
      });
      sock.once("error", () => {
        clearTimeout(timer);
        settle(false);
      });
    });
  }

  async function writeRpcToSockPath(sockPath: string, line: string): Promise<boolean> {
    for (let attempt = 0; attempt < WRITE_RPC_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, WRITE_RPC_RETRY_DELAYS_MS[attempt - 1]));
      }
      const ok = await tryConnectAndWrite(sockPath, line, WRITE_RPC_ATTEMPT_TIMEOUT_MS).catch(() => false);
      if (ok) return true;
    }
    return false;
  }

  async function writeRpc(sessionId: string, line: string): Promise<boolean> {
    const sockPath = sockPathFor(sessionsDir, sessionId, platform);
    return writeRpcToSockPath(sockPath, line);
  }

  function killKeeper(sessionId: string): boolean {
    const pid = tracked.get(sessionId);
    if (typeof pid !== "number") return false;
    try {
      killPidWithGroup(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }

  function readPidSidecar(p: string): number | null {
    try {
      const raw = readFileSync(p, "utf8").trim();
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  function unlinkQuiet(p: string): void {
    try { unlinkSync(p); } catch { /* ignore */ }
  }

  async function discoverExistingKeepers(): Promise<KeeperEntry[]> {
    if (!existsSync(sessionsDir)) return [];
    let names: string[];
    try { names = readdirSync(sessionsDir); } catch { return []; }

    const result: KeeperEntry[] = [];
    // The PID sidecar is the source of truth (Windows named pipes have no
    // filesystem entry to scan). On Unix the .pid sidecar lives alongside
    // the .sock; on Windows it's named `pi-rpc-<sid>.pid`.
    const isWin = platform === "win32";
    for (const name of names) {
      let sessionId: string | null = null;
      if (isWin) {
        const m = name.match(/^pi-rpc-(.+)\.pid$/);
        if (m) sessionId = m[1];
      } else {
        const m = name.match(/^(.+)\.rpc\.sock\.pid$/);
        if (m) sessionId = m[1];
      }
      if (!sessionId) continue;

      const pidFile = path.join(sessionsDir, name);
      const sockPath = sockPathFor(sessionsDir, sessionId, platform);
      const keeperPid = readPidSidecar(pidFile);

      if (!keeperPid || !isProcessAlive(keeperPid)) {
        // Stale keeper sidecar: clean it up. Best-effort socket unlink too.
        unlinkQuiet(pidFile);
        if (!isWin) unlinkQuiet(sockPath);
        continue;
      }

      if (!isPiAlive(sessionId, keeperPid)) {
        // Keeper alive but pi dead → kill keeper, clean up.
        try { killPidWithGroup(keeperPid, "SIGTERM"); } catch { /* ignore */ }
        unlinkQuiet(pidFile);
        if (!isWin) unlinkQuiet(sockPath);
        continue;
      }

      tracked.set(sessionId, keeperPid);
      result.push({ sessionId, keeperPid, sockPath });
    }
    return result;
  }

  function isKeeperAlive(sessionId: string): boolean {
    const keeperPid = readPidSidecar(pidPathFor(sessionsDir, sessionId, platform));
    return keeperPid !== null && isProcessAlive(keeperPid) && isPiAlive(sessionId, keeperPid);
  }

  return {
    spawnKeeperFor,
    writeRpc,
    writeRpcToSockPath,
    killKeeper,
    discoverExistingKeepers,
    isKeeperAlive,
    sessionsDir,
  };
}
