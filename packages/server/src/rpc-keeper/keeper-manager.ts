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
  statSync,
  truncateSync,
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
import { isUnsafeTestHomeScan as defaultIsUnsafeTestHomeScan } from "../auth/test-env-guard.js";

// ── Path conventions ─────────────────────────────────────────────────────────

function defaultSessionsDir(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "sessions");
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

/**
 * Path of the keeper's *pi-PID* sidecar (distinct from the keeper `.pid`).
 * Written by `keeper.cjs` after pi is spawned; read by discovery to fill an
 * absent `piPid`. The suffix ends in `-pid` (NOT `.pid`) so the keeper-sidecar
 * discovery scans never match it. See change: fix-keeper-session-identity-and-reattach.
 */
export function piPidPathFor(
  sessionsDir: string,
  sessionId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? path.join(sessionsDir, `pi-rpc-${sessionId}.pi-pid`)
    : `${sockPathFor(sessionsDir, sessionId, platform)}.pi-pid`;
}

function keeperLogPath(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, `keeper-${sessionId}.log`);
}

// ── Keeper-log maintenance (fix-runaway-keeper-log-growth) ───────────────

/** One keeper log file as seen by `listKeeperLogs()`. */
export interface KeeperLogFileStat {
  path: string;
  sessionId: string;
  size: number;
  mtimeMs: number;
  /** `keeper-launch-*.log` bootstrap-stderr logs — counted separately, never swept. */
  isLaunchLog: boolean;
}

export interface KeeperLogSweepResult {
  scanned: number;
  reclaimedFiles: number;
  reclaimedBytes: number;
  skippedLive: number;
}

export interface KeeperLogStats {
  totalBytes: number;
  fileCount: number;
  largestBytes: number;
  /** Owned by the sweep; a stats refresh never recomputes it (the bytes are no longer on disk). */
  reclaimedBytes: number;
  /** Keeper logs at/over 2× cap — the cross-process "rotation is not working here" signal (design D6). */
  runawayFiles: number;
  launchLogFiles: number;
  launchLogBytes: number;
}

/**
 * Explicitly-typed all-zero constant for the degraded case — the convention
 * `EMPTY_TRIM_STATS` established for `/api/health`: `a ?? b` does NOT check
 * `b` against `A`, so an inline literal could silently omit a field.
 * See change: fix-runaway-keeper-log-growth (D6, task 4.2).
 */
export const EMPTY_KEEPER_LOG_STATS: KeeperLogStats = {
  totalBytes: 0,
  fileCount: 0,
  largestBytes: 0,
  reclaimedBytes: 0,
  runawayFiles: 0,
  launchLogFiles: 0,
  launchLogBytes: 0,
};

/** Keeper-log cap default — mirrors `DEFAULT_KEEPER_LOG.maxBytes` in the shared config (the keeper-manager must not import config; design D7). */
export const DEFAULT_KEEPER_LOG_MAX_BYTES = 134217728; // 128 MiB
/** Sweep age gate default — mirrors the design's 5-minute politeness window. */
export const DEFAULT_SWEEP_MIN_AGE_MS = 5 * 60_000;
/** Stats cache TTL default — `/api/health` is polled unguarded; never scan per request. */
export const DEFAULT_KEEPER_LOG_STATS_TTL_MS = 60_000;

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
  /**
   * Pi's PID, read from the keeper's post-spawn pi-PID sidecar and surfaced
   * ONLY when the sidecar is present, parseable, AND names a live process.
   * Optional by construction: keepers spawned before this change (or whose
   * sidecar write failed) have none. Fills an absent registry `piPid` during
   * reconciliation; it never arbitrates against a live capture.
   *
   * DELIBERATELY OPTIONAL on both this declaration and the registry's
   * `KeeperWriter.discoverExistingKeepers` return type: an optional field keeps
   * structurally-compatible test fakes valid under TypeScript return covariance
   * (requiring it would break them). See change: fix-keeper-session-identity-and-reattach.
   */
  piPid?: number;
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
  /**
   * Startup disk-hygiene sweep (fix-runaway-keeper-log-growth D5): truncate
   * oversized, aged keeper logs of sessions with no live keeper process to
   * ZERO bytes. NEVER unlinks — an unlinked-but-written inode is invisible
   * to every size check and worse than the bug this change fixes. Also seeds
   * the keeper-log stats snapshot (including `reclaimedBytes`) from its own
   * result. Run once per server start, after `discoverExistingKeepers()`.
   */
  sweepKeeperLogs(): KeeperLogSweepResult;
  /**
   * Cached keeper-log stats for `/api/health` — refreshed lazily at most
   * once per `statsTtlMs` (design D6: health must not amplify into a
   * directory scan).
   */
  getKeeperLogStats(): KeeperLogStats;
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
  /**
   * Keeper-log rotation cap in bytes (sweep gate + `runawayFiles` threshold
   * base). Default 128 MiB. The composition root passes
   * `loadConfig().keeperLog.maxBytes` — deliberately NOT a `loadConfig`
   * import: this module has no config dependency and that keeps its tests
   * cheap (design D7, task 3.1).
   */
  maxBytes?: number;
  /** Sweep age gate: only logs untouched this long are reclaimable. Default 5 min. */
  sweepMinAgeMs?: number;
  /** Stats cache TTL. Default 60 s. */
  statsTtlMs?: number;
  /** Test seam — override the unsafe-test-home guard that gates ALL directory scans. */
  isUnsafeTestHomeScan?: () => boolean;
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
  // Default probe reads the pi-PID sidecar and tests that PID for liveness.
  // ABSENCE MAPS TO ALIVE (never dead): this gates a destructive branch
  // (`if (!isPiAlive) { killKeeper; unlink }`), the sidecar write is allowed
  // to fail without tearing pi down, and pre-change keepers have no sidecar
  // at all — so a missing file must not SIGTERM a healthy keeper. Only a
  // present, parseable, non-live PID returns false.
  // See change: fix-keeper-session-identity-and-reattach (Decision 4).
  const isPiAlive =
    opts.isPiAliveForSession ??
    ((sessionId: string): boolean => {
      const piPid = readPidSidecar(piPidPathFor(sessionsDir, sessionId, platform));
      return piPid === null ? true : isProcessAlive(piPid);
    });
  const spawnDetached = opts.spawnDetached ?? defaultSpawnDetached;
  const createConnection = opts.createConnection ?? net.createConnection;
  // Keeper-log maintenance thresholds (design D7: read at server start from
  // the injected options, not per call — a config change needs a restart to
  // re-scope the sweep, which is the documented semantics).
  const logMaxBytes = opts.maxBytes ?? DEFAULT_KEEPER_LOG_MAX_BYTES;
  const sweepMinAgeMs = opts.sweepMinAgeMs ?? DEFAULT_SWEEP_MIN_AGE_MS;
  const statsTtlMs = opts.statsTtlMs ?? DEFAULT_KEEPER_LOG_STATS_TTL_MS;
  const isUnsafeScan = opts.isUnsafeTestHomeScan ?? defaultIsUnsafeTestHomeScan;

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
      // The sidecar contract is a BARE decimal integer. `Number.parseInt` is
      // too lenient — it accepts numeric prefixes ("123junk"→123, "1e3"→1,
      // "12.5"→12), which could surface a wrong pid or make discovery SIGTERM a
      // live keeper. Reject anything that is not pure digits as unparseable.
      // See change: fix-keeper-session-identity-and-reattach (CodeRabbit hardening).
      if (!/^\d+$/.test(raw)) return null;
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
      // Never treat a pi-PID sidecar as a keeper sidecar. Belt-and-braces
      // beyond the `-pid` suffix already dodging the scan patterns below, so a
      // future rename cannot silently reintroduce a phantom keeper whose
      // sessionId is `<sid>.pi`. See change: fix-keeper-session-identity-and-reattach.
      if (name.endsWith(".pi-pid")) continue;
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

      const piPidFile = piPidPathFor(sessionsDir, sessionId, platform);

      if (!keeperPid || !isProcessAlive(keeperPid)) {
        // Stale keeper sidecar: clean it up. Best-effort socket + pi-PID
        // sidecar unlink too so no stale file outlives the dead keeper.
        unlinkQuiet(pidFile);
        if (!isWin) unlinkQuiet(sockPath);
        unlinkQuiet(piPidFile);
        continue;
      }

      if (!isPiAlive(sessionId, keeperPid)) {
        // Keeper alive but pi dead → kill keeper, clean up.
        try { killPidWithGroup(keeperPid, "SIGTERM"); } catch { /* ignore */ }
        unlinkQuiet(pidFile);
        if (!isWin) unlinkQuiet(sockPath);
        unlinkQuiet(piPidFile);
        continue;
      }

      // Live keeper: surface pi's PID from the sidecar ONLY when it names a
      // live process. A missing / unparseable / dead PID leaves piPid unset;
      // the registry then logs it as unavailable and leaves the entry alone.
      const sidecarPiPid = readPidSidecar(piPidFile);
      const piPid = sidecarPiPid !== null && isProcessAlive(sidecarPiPid) ? sidecarPiPid : undefined;

      tracked.set(sessionId, keeperPid);
      result.push({ sessionId, keeperPid, sockPath, piPid });
    }
    return result;
  }

  function isKeeperAlive(sessionId: string): boolean {
    const keeperPid = readPidSidecar(pidPathFor(sessionsDir, sessionId, platform));
    return keeperPid !== null && isProcessAlive(keeperPid) && isPiAlive(sessionId, keeperPid);
  }

  // ── Keeper-log maintenance (fix-runaway-keeper-log-growth) ────────────

  /**
   * ONE enumeration of `keeper-*.log` files, shared by the sweep and the
   * stats refresh so the measured set and the acted-on set cannot drift
   * (design D6). One readdir, one stat per match. Match `keeper-<sid>.log`
   * ONLY — a naive `^keeper-(.+)\.log$` reads `keeper-launch-<uuid>.log` as
   * session `launch-<uuid>` (always "dead", and miscounted in stats).
   * Gated by `isUnsafeTestHomeScan()`: an ungated scan of a developer's real
   * sessions dir at boot is how a hygiene sweep becomes an incident.
   */
  function listKeeperLogs(): KeeperLogFileStat[] {
    if (isUnsafeScan()) return [];
    if (!existsSync(sessionsDir)) return [];
    let names: string[];
    try {
      names = readdirSync(sessionsDir);
    } catch {
      return [];
    }
    const out: KeeperLogFileStat[] = [];
    for (const name of names) {
      if (!name.startsWith("keeper-") || !name.endsWith(".log")) continue;
      const isLaunchLog = name.startsWith("keeper-launch-");
      const sessionId = name.slice("keeper-".length, name.length - ".log".length);
      let st;
      try {
        st = statSync(path.join(sessionsDir, name));
      } catch {
        continue; // raced away between readdir and stat — skip
      }
      out.push({
        path: path.join(sessionsDir, name),
        sessionId,
        size: st.size,
        mtimeMs: st.mtimeMs,
        isLaunchLog,
      });
    }
    return out;
  }

  let statsSnapshot: KeeperLogStats = { ...EMPTY_KEEPER_LOG_STATS };
  let statsRefreshedAt = 0;

  function refreshStatsNow(): void {
    statsRefreshedAt = Date.now();
    const files = listKeeperLogs();
    const keeper = files.filter((f) => !f.isLaunchLog);
    const launch = files.filter((f) => f.isLaunchLog);
    statsSnapshot = {
      totalBytes: keeper.reduce((acc, f) => acc + f.size, 0),
      fileCount: keeper.length,
      largestBytes: keeper.reduce((acc, f) => Math.max(acc, f.size), 0),
      // reclaimedBytes is owned by the sweep (seeded by sweepKeeperLogs and
      // preserved across refreshes): the reclaimed bytes are by definition no
      // longer on disk, so recomputing them from a rescan would zero the one
      // field that proves the sweep ran. See X11 / design D6.
      reclaimedBytes: statsSnapshot.reclaimedBytes,
      // 2× cap, not cap: a healthy log oscillates through
      // [cap, cap + rate×interval] on every refill — a ≥cap counter would
      // fire on perfectly-rotating keepers and ruin the one observable that
      // exists to catch silent non-rotation. Heuristic, not proof (design D6).
      runawayFiles: keeper.filter((f) => f.size >= 2 * logMaxBytes).length,
      launchLogFiles: launch.length,
      launchLogBytes: launch.reduce((acc, f) => acc + f.size, 0),
    };
  }

  function sweepKeeperLogs(): KeeperLogSweepResult {
    const result: KeeperLogSweepResult = {
      scanned: 0,
      reclaimedFiles: 0,
      reclaimedBytes: 0,
      skippedLive: 0,
    };
    for (const f of listKeeperLogs()) {
      if (f.isLaunchLog) continue;
      result.scanned += 1;
      // Liveness gate — POLITENESS, not safety (design D5): every liveness
      // predicate is defeatable here (discovery unlinks sidecars without
      // verifying the kill; the pi child holds a dup'd fd and survives a
      // SIGKILLed keeper). Truncation is what makes being wrong acceptable:
      // no writer is ever detached, the inode stays visible. The gate still
      // protects a live session's log from being blanked mid-debug.
      // PID sidecar + isProcessAlive — deliberately NOT isKeeperAlive, which
      // would also demand a live PI: a keeper whose pi just died is exactly
      // the keeper whose oversized log we may still be debugging with.
      // A MISSING sidecar maps to reclaimable-when-aged: discovery already
      // unlinked the sidecars of confirmed-dead keepers, so the incident
      // residue this sweep exists for has no sidecar — while a keeper still
      // starting is protected by the age gate below (its sidecar write lands
      // within milliseconds of log creation).
      const keeperPid = readPidSidecar(pidPathFor(sessionsDir, f.sessionId, platform));
      if (keeperPid !== null && isProcessAlive(keeperPid)) {
        result.skippedLive += 1;
        continue;
      }
      // Age gate: keeper shutdown writes final lines refreshing mtime, so a
      // just-ended session survives one sweep cadence; a still-starting
      // keeper (sidecar not yet written) is likewise protected here.
      if (Date.now() - f.mtimeMs < sweepMinAgeMs) continue;
      if (f.size < logMaxBytes) continue;
      try {
        // Truncate to zero, NEVER unlink (design D5): discovery unlinks
        // sidecars unconditionally, so a wedged keeper can survive with every
        // sidecar gone, and the pi child holds its own fd — an unlinked inode
        // with a live writer keeps growing, invisible to readdir, stat, and
        // every health stat. Zero-byte tombstones join the thousands of small
        // files already in this directory.
        truncateSync(f.path, 0);
        result.reclaimedFiles += 1;
        result.reclaimedBytes += f.size;
      } catch {
        // Per-file failure (EACCES, race) must not fail the sweep or the
        // startup that hosts it (X8).
      }
    }
    // Seed the stats snapshot from the sweep result so the first /api/health
    // read already carries the reclaimed total (task 3.4).
    refreshStatsNow();
    statsSnapshot = { ...statsSnapshot, reclaimedBytes: result.reclaimedBytes };
    return result;
  }

  function getKeeperLogStats(): KeeperLogStats {
    if (Date.now() - statsRefreshedAt >= statsTtlMs) {
      try {
        refreshStatsNow();
      } catch {
        // A throwing refresh must never 500 the health hot path; serve the
        // last snapshot (zeros on a fresh boot).
      }
    }
    return statsSnapshot;
  }

  return {
    spawnKeeperFor,
    writeRpc,
    writeRpcToSockPath,
    killKeeper,
    discoverExistingKeepers,
    isKeeperAlive,
    sweepKeeperLogs,
    getKeeperLogStats,
    sessionsDir,
  };
}
